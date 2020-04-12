<script>
    export let peers;

    const getDistanceText = (volume) => {
        if(volume >= 0.8) {
            return "Sehr nah";
        } else if(volume >= 0.5) {
            return "Nah";
        } else if(volume >= 0.2) {
            return "Entfernt";
        } else {
            return "Kaum zu hören";
        }
    };

    $: peersText = peers.length === 0 ? "Du redest derzeit mit keinen Spielern." : "Du redest derzeit mit den folgenden Spielern:";
</script>

<style>
    .peersContainer h1 {
        margin-top: 1.5rem;
        font-weight: bold;
        font-size: 1.2rem;
        color: #384f78;
    }
    .peersContainer ul {
        display: flex;
        flex-wrap: wrap;
        list-style: none;
        padding: 0;
        justify-content: flex-start;
    }
    .peersContainer ul li {
        padding: 0.5rem 2rem;
        border-radius: 50px;
        background: #a9bad1;
    }
    .peersContainer ul li p {
        display: inline;
        margin: 0;
        color: #384f78;
        font-weight: bold;
    }
    .peersContainer ul li span {
        color: #576276;
        padding-left: 0.5rem;
    }
</style>

<div class="peersContainer">
    <h1>{peersText}</h1>
    <ul>
        {#each peers as { playerId, playerName, volume, isConnectedToVoiceChat }, i}
            <li>
                <p>{playerName}</p>
                <span>{getDistanceText(volume)}</span>
            </li>
        {/each}
    </ul>
</div>

