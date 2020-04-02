<script>
	import io from 'socket.io-client';
    import ss from 'socket.io-stream';

    import { onMount, onDestroy } from 'svelte';

    var jq = null; // will be set to jquery instance in onMount

    /** CONFIG **/
    var SIGNALING_SERVER = "http://localhost:3000";
    var USE_AUDIO = true;
    var USE_VIDEO = false;
    var DEFAULT_CHANNEL = 'some-global-channel-name';
    var MUTE_AUDIO_BY_DEFAULT = false;

    /** You should probably use a different stun server doing commercial stuff **/
    /** Also see: https://gist.github.com/zziuni/3741933 **/
    var ICE_SERVERS = [
        {url:"stun:stun.l.google.com:19302"}
    ];

    var signaling_socket = null;   /* our socket.io connection to our webserver */
    var local_media_stream = null; /* our own microphone / webcam */
    var peers = {};                /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
    var peer_media_elements = {};  /* keep track of our <video>/<audio> tags, indexed by peer_id */

    let microphoneActivated = false;
    $: microphoneToggleText = "Mikrofon " + (microphoneActivated ? "deaktivieren" : "aktivieren");

    onMount(() => {
        jq = window.$;
		init();
    });

    onDestroy(() => {
        disconnect();
    });

    function handleDisconnectButtonClick() {
        disconnect();
    }

    // TODO Decide on a way to get player position updates and adjust volume based on them, maybe 
    // using audio animate https://stackoverflow.com/questions/7451508/html5-audio-playback-with-fade-in-and-fade-out

    function disconnect() {
        /* Tear down all of our peer connections and remove all the
         * media divs when we disconnect */
        console.log("Closing connections");
        
        for (let peer_id in peer_media_elements) {
            peer_media_elements[peer_id].remove();
        }
        
        for (let peer_id in peers) {
            console.log("Closing peer connection with ", peer_id);
            peers[peer_id].close();
        }

        signaling_socket = null;
        local_media_stream = null;
        peers = {};
        peer_media_elements = {};

        // TODO Fix disconnect. Maybe use socket.emit('disconnect') ?
    }

    $: {
        if(!!local_media_stream) {
            local_media_stream.getTracks().forEach((track) => {
                track.enabled = microphoneActivated;
            });
        }
    }
    
    function init() {
        console.log("Connecting to signaling server");
        signaling_socket = io(SIGNALING_SERVER);

        signaling_socket.on('connect', function() {
            console.log("Connected to signaling server");
            setup_local_media(function() {
                /* once the user has given us access to their
                    * microphone/camcorder, join the channel and start peering up */
                join_chat_channel(DEFAULT_CHANNEL, {'whatever-you-want-here': 'stuff'});
            });
        });

        signaling_socket.on('disconnect', function() {
            console.log("Disconnected from signaling server");
            /* Tear down all of our peer connections and remove all the
             * media divs when we disconnect */
            console.log("Closing connections");
            
            for (let peer_id in peer_media_elements) {
                peer_media_elements[peer_id].remove();
            }

            for (let peer_id in peers) {
                peers[peer_id].close();
            }

            peers = {};
            peer_media_elements = {};
        });

        function join_chat_channel(channel, userdata) {
            signaling_socket.emit('join', {"channel": channel, "userdata": userdata});
        }

        function part_chat_channel(channel) {
            signaling_socket.emit('part', channel);
        }

        /** 
        * When we join a group, our signaling server will send out 'addPeer' events to each pair
        * of users in the group (creating a fully-connected graph of users, ie if there are 6 people
        * in the channel you will connect directly to the other 5, so there will be a total of 15 
        * connections in the network). 
        */
        signaling_socket.on('addPeer', function(config) {
            console.log('Signaling server said to add peer:', config);
            var peer_id = config.peer_id;
            if (peer_id in peers) {
                /* This could happen if the user joins multiple channels where the other peer is also in. */
                console.log("Already connected to peer ", peer_id);
                return;
            }
            var peer_connection = new RTCPeerConnection(
                {"iceServers": ICE_SERVERS},
                {"optional": [{"DtlsSrtpKeyAgreement": true}]} /* this will no longer be needed by chrome
                                                                * eventually (supposedly), but is necessary 
                                                                * for now to get firefox to talk to chrome */
            );
            peers[peer_id] = peer_connection;

            peer_connection.onicecandidate = function(event) {
                if (event.candidate) {
                    signaling_socket.emit('relayICECandidate', {
                        'peer_id': peer_id, 
                        'ice_candidate': {
                            'sdpMLineIndex': event.candidate.sdpMLineIndex,
                            'candidate': event.candidate.candidate
                        }
                    });
                }
            }

            peer_connection.ontrack  = function(event) {
                console.log("onTrack:", event);
                var remote_media = USE_VIDEO ? jq("<video>") : jq("<audio>");

                var player = remote_media[0];
                player.autoplay = true;
                if (MUTE_AUDIO_BY_DEFAULT) {
                    player.muted = true;
                }
                player.controls = true;
                player.srcObject = event.streams[0];

                // TODO Set peer volume for client

                peer_media_elements[peer_id] = remote_media;
                jq('#audioContainer').append(remote_media);
            }

            peer_connection.onconnectionstatechange = function(event) {
                console.log("Peer connection state change: ", peer_connection.connectionState);
                switch(peer_connection.connectionState) {
                    case "connected":
                    // The connection has become fully connected
                    break;
                    case "disconnected":
                    case "failed":
                    // One or more transports has terminated unexpectedly or in an error
                    break;
                    case "closed":
                    // The connection has been closed
                    break;
                }
            }

            /* Add our local stream */
            local_media_stream.getTracks().forEach(function(track) {
                peer_connection.addTrack(track, local_media_stream);
            });

            /* Only one side of the peer connection should create the
                * offer, the signaling server picks one to be the offerer. 
                * The other user will get a 'sessionDescription' event and will
                * create an offer, then send back an answer 'sessionDescription' to us
                */
            if (config.should_create_offer) {
                console.log("Creating RTC offer to ", peer_id);
                // TODO Change to promise based https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createOffer
                peer_connection.createOffer(
                    function (local_description) { 
                        console.log("Local offer description is: ", local_description);
                        peer_connection.setLocalDescription(local_description,
                            function() { 
                                signaling_socket.emit('relaySessionDescription', 
                                    {'peer_id': peer_id, 'session_description': local_description});
                                console.log("Offer setLocalDescription succeeded"); 
                            },
                            function() { Alert("Offer setLocalDescription failed!"); }
                        );
                    },
                    function (error) {
                        console.log("Error sending offer: ", error);
                    });
            }
        });


        /** 
            * Peers exchange session descriptions which contains information
            * about their audio / video settings and that sort of stuff. First
            * the 'offerer' sends a description to the 'answerer' (with type
            * "offer"), then the answerer sends one back (with type "answer").  
            */
        signaling_socket.on('sessionDescription', function(config) {
            console.log('Remote description received: ', config);
            var peer_id = config.peer_id;
            var peer = peers[peer_id];
            var remote_description = config.session_description;
            console.log(config.session_description);

            var desc = new RTCSessionDescription(remote_description);
            var stuff = peer.setRemoteDescription(desc, 
                function() {
                    console.log("setRemoteDescription succeeded");
                    if (remote_description.type == "offer") {
                        console.log("Creating answer");
                        peer.createAnswer(
                            function(local_description) {
                                console.log("Answer description is: ", local_description);
                                peer.setLocalDescription(local_description,
                                    function() { 
                                        signaling_socket.emit('relaySessionDescription', 
                                            {'peer_id': peer_id, 'session_description': local_description});
                                        console.log("Answer setLocalDescription succeeded");
                                    },
                                    function() { Alert("Answer setLocalDescription failed!"); }
                                );
                            },
                            function(error) {
                                console.log("Error creating answer: ", error);
                                console.log(peer);
                            });
                    }
                },
                function(error) {
                    console.log("setRemoteDescription error: ", error);
                }
            );
            console.log("Description Object: ", desc);

        });

        /**
            * The offerer will send a number of ICE Candidate blobs to the answerer so they 
            * can begin trying to find the best path to one another on the net.
            */
        signaling_socket.on('iceCandidate', function(config) {
            var peer = peers[config.peer_id];
            var ice_candidate = config.ice_candidate;
            peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
        });

        /**
            * When a user leaves a channel (or is disconnected from the
            * signaling server) everyone will recieve a 'removePeer' message
            * telling them to trash the media channels they have open for those
            * that peer. If it was this client that left a channel, they'll also
            * receive the removePeers. If this client was disconnected, they
            * wont receive removePeers, but rather the
            * signaling_socket.on('disconnect') code will kick in and tear down
            * all the peer sessions.
            */
        signaling_socket.on('removePeer', function(config) {
            console.log('Signaling server said to remove peer:', config);
            var peer_id = config.peer_id;
            if (peer_id in peer_media_elements) {
                peer_media_elements[peer_id].remove();
            }
            if (peer_id in peers) {
                peers[peer_id].close();
            }

            delete peers[peer_id];
            delete peer_media_elements[config.peer_id];
        });
    }

    /***********************/
    /** Local media stuff **/
    /***********************/
    function setup_local_media(callback, errorback) {
        if (local_media_stream != null) {  /* ie, if we've already been initialized */
            if (callback) callback();
            return; 
        }
        /* Ask user for permission to use the computers microphone and/or camera, 
            * attach it to an <audio> or <video> tag if they give us access. */
        console.log("Requesting access to local audio / video inputs");

        navigator.mediaDevices.getUserMedia({"audio":USE_AUDIO, "video":USE_VIDEO})
        .then(function(stream) {
            console.log("Access granted to audio/video");
            local_media_stream = stream;
            var local_media = USE_VIDEO ? jq("<video>") : jq("<audio>");
            
            var player = local_media[0]
            player.autoplay = true;
            player.muted = true; /* always mute ourselves by default */
            player.controls = true; /* results in own player not being shown for audio */
            player.srcObject = stream;
            
            jq('#audioContainer').append(local_media);
            
            if (callback) callback();
        })
        .catch(function(err) {
            console.log("Access denied for audio/video", err);
            alert("You chose not to provide access to the camera/microphone, demo will not work.");
            if (errorback) errorback();
        });
    }
	
</script>

<style>
	figure {
		margin: 0 0 1em 0;
	}

	img {
		width: 100%;
		max-width: 400px;
		margin: 0 0 1em 0;
	}
</style>

<svelte:head>
	<title>VoiceChat</title>
</svelte:head>

<h1>Miclanity VoiceChat</h1>

<figure>
	<img alt='Borat' src='great-success.png'>
	<figcaption>HIGH FIVE!</figcaption>
</figure>

<label>
    <input 
        type="checkbox" 
        bind:checked={microphoneActivated}
        disabled={!local_media_stream}
    >
    {microphoneToggleText}
</label>

<button on:click={handleDisconnectButtonClick}>Disconnect</button>

<div id="audioContainer">
    <!-- 
    the <video> and <audio> tags are all added and removed dynamically
    in 'onAddStream', 'setup_local_media', and 'removePeer'/'disconnect'
    -->
</div>
