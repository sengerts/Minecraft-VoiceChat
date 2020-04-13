<script>
    import { onMount } from 'svelte';

    import io from 'socket.io-client';

    onMount(() => {
        window.WebSocket = window.WebSocket || window.MozWebSocket;

        const voiceDataSocket = io("https://safe-springs-63253.herokuapp.com/voicedata");

        voiceDataSocket.on('connect', function() {
            console.log("Opened websocket connection!");
        });
    });  
</script>

<h1>Test</h1>