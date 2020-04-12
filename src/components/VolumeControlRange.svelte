<script>
    export let text;
    export let handleVolumeChange;
</script>

<style>
    div {
        margin-top: 1.5rem;
    }
    label {
        font-weight: bold;
        color: #384f78;
        font-size: 1.2rem;
    }
    input[type=range] {
        height: 37px;
        -webkit-appearance: none;
        margin: 0;
        width: 100%;
        background: none;
    }
    input[type=range]:focus {
        outline: none;
    }
    input[type=range]::-webkit-slider-runnable-track {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: #a9bad1;
        border: 1px solid #919db5;
        border-radius: 10px;
    }
    input[type=range]::-webkit-slider-thumb {
        border: 1px solid #384F78;
        height: 19px;
        width: 19px;
        border-radius: 19px;
        background: #384f78;
        cursor: pointer;
        -webkit-appearance: none;
        margin-top: -6px;
    }
    input[type=range]::-moz-range-track {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: #a9bad1;
        border: 1px solid #919db5;
        border-radius: 10px;
    }
    input[type=range]::-moz-range-thumb {
        border: 1px solid #384F78;
        height: 19px;
        width: 19px;
        border-radius: 19px;
        background: #384f78;
        cursor: pointer;
        -webkit-appearance: none;
        margin-top: -6px;
    }
    input[type=range]::-ms-track {
        width: 100%;
        height: 14px;
        cursor: pointer;
        background: transparent;
        border-color: transparent;
        color: transparent;
    }
    input[type=range]::-ms-fill-lower {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: #a9bad1;
        border: 1px solid #919db5;
        border-radius: 10px;
    }
    input[type=range]::-ms-fill-upper {
        width: 100%;
        height: 8px;
        cursor: pointer;
        background: #a9bad1;
        border: 1px solid #919db5;
        border-radius: 10px;
    }
    input[type=range]::-ms-thumb {
        border: 1px solid #384F78;
        height: 19px;
        width: 19px;
        border-radius: 19px;
        background: #384f78;
        cursor: pointer;
        -webkit-appearance: none;
        margin-top: -6px;
    }
</style>

<div>
    <label for="volume">{text}</label>
    <input type="range" name="volume" min="0" max="1" value="1" step="0.01" on:input={handleVolumeChange}/>
</div>