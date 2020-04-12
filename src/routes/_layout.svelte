<style>
	main {
		position: relative;
		max-width: 56em;
		background-color: rgba(255, 255, 255, .7);
		border-radius: 5px;
		padding: 2em;
		margin: 0 auto;
		margin-top: 90px;
		box-sizing: border-box;
		box-shadow: 0 1px 1px rgba(42, 55, 78, 0.21), 
					0 2px 2px rgba(42, 55, 78, 0.21), 
					0 4px 4px rgba(42, 55, 78, 0.21), 
					0 8px 8px rgba(42, 55, 78, 0.21), 
					0 16px 16px rgba(42, 55, 78, 0.21);
	}

	:global(body) {
		background: url(https://jimdo-storage.freetls.fastly.net/image/68140565/0cd9f001-ae61-4c6c-8fa3-dac588023a1e.png?quality=80&auto=webp&disable=upscale&width=1280&height=729&trim=174,537,149,94);
		background-size: cover;
		min-height: 100vh;
	}

	.bg-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		min-height: 100vh;
		height: 100%;
		background-image: linear-gradient(120deg, #8ba5d252 0%, #30446957 50%, #0c131f66 100%);
	}

	.credits {
		text-align: center;
    	margin-top: 10rem;
		color: #0e131c;
	}
</style>

<div class="bg-overlay"></div>

<main>
	<slot></slot>
</main>
<p class="credits">Entwickelt von <a href="https://github.com/sengerts/">Tobias Senger</a></p>