const getLocalUserMedia = (useAudio, useVideo, jq) => {
    /* Ask user for permission to use the computers microphone and/or camera, 
        * attach it to an <audio> or <video> tag if they give us access. */
    console.log("Requesting access to local audio / video inputs");

    return new Promise((resolve, reject) => {
        navigator.mediaDevices.getUserMedia({ "audio": useAudio, "video": useVideo })
            .then(function(stream) {
            console.log("Access granted to audio/video");

            // cope with browser differences
            var audioContext = new (AudioContext || webkitAudioContext);
        
            // create a gain node (to change audio volume)
            //let volumeControlNode = audioContext.createGain();
            // default is 1 (no change); less than 1 means audio is attenuated and vice versa
            //volumeControlNode.gain.value = 1;
            //
            //var peer = audioContext.createMediaStreamDestination();
            //var microphone = audioContext.createMediaStreamSource(stream);
            //microphone.connect(volumeControlNode);
            //volumeControlNode.connect(peer);

            let localMediaStream = peer.stream;

            var local_media = useVideo ? jq("<video>") : jq("<audio>");
            
            var player = local_media[0];
            player.autoplay = true;
            player.muted = true; /* always mute ourselves by default */
            player.controls = true; /* results in own player not being shown for audio */
            player.srcObject = peer.stream;
            
            jq('#audioContainer').append(local_media);

            resolve({
                volumeControlNode: undefined, // TODO 
                localMediaStream
            });
        }).catch(err => {
            reject(err);
        });
    });
};

export default getLocalUserMedia;