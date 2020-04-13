<script context="module">
	export async function preload({ params, query }) {
		// the `slug` parameter is available because
		// this file is called [slug].svelte
		const playerToken = params.slug;
		return { playerToken };
	}
</script>

<script>
	export let playerToken;

	import io from 'socket.io-client';

	import { goto } from '@sapper/app';
    import { onMount, onDestroy } from 'svelte';

    import getLocalUserMedia from '../../mediaHelpers/localMediaHelper';
    import VolumeControlRange from '../../components/VolumeControlRange';
    import PeersTalkingToContainer from '../../components/PeersTalkingToContainer';

    var jq = null; // will be set to jquery instance in onMount

    /** CONFIG **/
    var SIGNALING_SERVER = "/voice";
    var USE_AUDIO = true;
    var USE_VIDEO = false;
    var DEFAULT_CHANNEL = 'voice-channel';
    var MUTE_AUDIO_BY_DEFAULT = false;

    /** You should probably use a different stun server doing commercial stuff **/
    /** Also see: https://gist.github.com/zziuni/3741933 **/
    var ICE_SERVERS = [
        { url: "stun:stun.l.google.com:19302" }
    ];

    var signaling_socket = null;   /* our socket.io connection to our webserver */
    var local_media_stream = null; /* our own microphone / webcam */
    var peers = {};                /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
    var peer_media_elements = {};  /* keep track of our <video>/<audio> tags, indexed by peer_id */
    var volumeControlNode;
    var globalVolumeControlNodes = {};
    var userVolumeControlNodes = {};

    let ownMicrophoneActivated = false;
    $: microphoneToggleText = "Mikrofon " + (ownMicrophoneActivated ? "aktiviert" : "deaktiviert");
    let deniedMicrophoneAccess = false;
    let peersData = [];

    onMount(() => {
        jq = window.$;
		init();
    });

    onDestroy(() => {
        disconnect();
    });

    function handleDisconnectButtonClick() {
        disconnect();
        goto('/');
    }
    
    function disconnect() {
        if(!signaling_socket) {
            return;
        }

        console.log("Disconnecting client..");

        signaling_socket.emit('disconnectClient');
        
        for (let peer_id in peer_media_elements) {
            peer_media_elements[peer_id].remove();
        }
        
        signaling_socket = null;
        local_media_stream = null;
        peers = {};
        peer_media_elements = {};
        globalVolumeControlNodes = {};
    }

    $: {
        if(!!local_media_stream) {
            local_media_stream.getTracks().forEach((track) => {
                track.enabled = ownMicrophoneActivated;
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
                console.log("Join channel");
                join_chat_channel(DEFAULT_CHANNEL, { playerToken });
            });
		});
		
		signaling_socket.on('invalidToken', function() {
            console.log("Invalid token!");
			goto('/');
        });

		signaling_socket.on('volumes', function({ microphoneActivated, volumes }) {
            console.log("Receiving volumes ", microphoneActivated, volumes);

            if(microphoneActivated != ownMicrophoneActivated) {
                ownMicrophoneActivated = microphoneActivated;
            }

            peersData = volumes.map(v => {
                return {
                    playerId: v.player,
                    playerName: v.playerName,
                    volume: v.volume,
                    isConnectedToVoiceChat: !!v.socketId,
                }
            }).sort((v1, v2) => v1.volume > v2.volume ? -1 : 1);

			for(let volume of volumes) {
				if(!(volume.socketId in peer_media_elements)) {
					continue;
                }

                console.log("Updating volume of peer ", volume.socketId, peer_media_elements[volume.socketId][0], volume.volume)
                userVolumeControlNodes[volume.socketId].gain.value = volume.volume;

                //const player = peer_media_elements[volume.socketId][0];
                //jq(player).animate({volume: volume.volume}, 100);

                // Without animating:
				//player.volume = volume.volume;
			}
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
            globalVolumeControlNodes = {};
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

                // Chrome forces us to attach the original audio stream to a video/ audio element, otherwise
                // the stream with gain node below will not work
                var raw_audio_media = USE_VIDEO ? jq("<video>") : jq("<audio>");
                var fakePlayer = raw_audio_media[0];
                fakePlayer.srcObject = event.streams[0];
                fakePlayer.autoplay = true;
                fakePlayer.muted = true;

                // This is the real video/ audio element with gain node attached
                var remote_media = USE_VIDEO ? jq("<video>") : jq("<audio>");

                var player = remote_media[0];
                player.autoplay = true;
                if (MUTE_AUDIO_BY_DEFAULT) {
                    player.muted = true;
                }
                player.controls = true;

                // TODO Test if Google Chrome is making difficulties for more than six AudioContext instances per Tab
                var AudioContext = window.AudioContext || window.webkitAudioContext;
                let audioCtx = new AudioContext();

                let mediaSource = audioCtx.createMediaStreamSource(event.streams[0]);
                
                let globalVolumeGainNode = audioCtx.createGain();
                globalVolumeGainNode.gain.value = 1;
                mediaSource.connect(globalVolumeGainNode);
                //globalVolumeGainNode.connect(audioCtx.destination);

                let userVolumeGainNode = audioCtx.createGain();
                userVolumeGainNode.gain.value = 1;
                globalVolumeGainNode.connect(userVolumeGainNode);
                userVolumeGainNode.connect(audioCtx.destination);

                let destinationNode = audioCtx.createMediaStreamDestination();
                globalVolumeGainNode.connect(destinationNode);
                
                player.srcObject = destinationNode.stream;

                userVolumeControlNodes[peer_id] = userVolumeGainNode;
                globalVolumeControlNodes[peer_id] = globalVolumeGainNode;
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
                peer_connection.createOffer(function (local_description) { 
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
            var stuff = peer.setRemoteDescription(desc, function() {
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
                }, function(error) {
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
            delete globalVolumeControlNodes[config.peer_id];
        });
    }

    function setup_local_media(callback, errorback) {
        if (local_media_stream != null) {  /* ie, if we've already been initialized */
            if (callback) callback();
            return; 
        }

        getLocalUserMedia(USE_AUDIO, USE_VIDEO, jq).then(result => {
            const { volumeControlNode: newVolumeControlNode, localMediaStream: newLocalMediaStream } = result;
            local_media_stream = newLocalMediaStream;
            volumeControlNode = newVolumeControlNode;

            if (callback) callback();
        }).catch(err => {
            console.log("Access denied for audio/video", err);
            deniedMicrophoneAccess = true;
            if (errorback) errorback();
        });
    }
</script>

<style>
    #audioContainer :global(video, audio) {
        display: none;
    }
	h1, .microphone h3 {
        font-weight: bold;
        color: #384f78;
        margin-bottom: 0;
    }
    h2, .microphone p {
        color: #576276;
    }
    .microphone {
        border: 1px solid #576276;
        padding: 1.5rem 2rem;
        margin: 2rem 0;
    }
    .microphone p {
        margin: 0;
    }
    .disconnect {
        position: absolute;
        right: 2rem;
        top: 4.5rem;
        background: #384f78;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 50px;
        color: #cdd7eb;
        cursor: pointer;
    }
    .deniedMicrophoneText {
        color: #da665a;
    }
    .deniedMicrophoneLinks {
        margin: 0;
    }
    .deniedMicrophoneLinks.first {
        margin-top: 2rem;
    }
</style>

<svelte:head>
	<title>VoiceChat - Verbunden</title>
</svelte:head>

<h1>Talebind VoiceChat</h1>

{#if deniedMicrophoneAccess}
    <h2 class="deniedMicrophoneText">Du musst dieser Website Zugriff auf dein Mikrofon durch deinen Browser gewähren und anschließend die Seite neuladen!</h2>
    <p class="deniedMicrophoneLinks first">Weitere Informationen für Chrome-Nutzer: <a href="https://support.google.com/chrome/answer/2693767?co=GENIE.Platform%3DDesktop&hl=de">Informationen</a></p>
    <p class="deniedMicrophoneLinks">Weitere Informationen für Firefox-Nutzer: <a href="https://support.mozilla.org/de/kb/kamera-und-mikrofonberechtigungen-verwalten">Informationen</a></p>
    <p class="deniedMicrophoneLinks">Weitere Informationen für Safari-Nutzer: <a href="https://support.apple.com/de-de/guide/safari/ibrwe2159f50/mac">Informationen</a></p>
{:else}
    {#if !signaling_socket}
        <h2>Verbindet..</h2>
    {:else}
        <h2>Verbunden</h2>
    {/if}

    <div class="microphone">
        <h3>{microphoneToggleText}</h3>
        <p>Du kannst dein Mikrofon im Spiel mit der Taste F aktivieren/ deaktivieren.</p>
    </div>

    {#if !!signaling_socket}
        <button class="disconnect" on:click={handleDisconnectButtonClick}>Verbindung schließen</button>
    {/if}

    <div id="audioContainer">
        <!-- 
        the <video> and <audio> tags are all added and removed dynamically
        in 'onAddStream', 'setup_local_media', and 'removePeer'/'disconnect'
        -->
    </div>

    <VolumeControlRange text={"Allgemeine Wiedergabe-Lautstärke:"} handleVolumeChange={(event) =>  {
        for(let peer_id in globalVolumeControlNodes) {
            globalVolumeControlNodes[peer_id].gain.value = event.target.value;
        }
    }}/>
    <VolumeControlRange text={"Deine Mikrofon-Lautstärke:"} handleVolumeChange={(event) =>  volumeControlNode.gain.value = event.target.value}/>
    <PeersTalkingToContainer peers={peersData.filter(v => v.isConnectedToVoiceChat && v.volume > 0)}/>
{/if}
