# 3D Drone AI Lab

A browser-based 3D drone tunnel simulator built with Three.js and a lightweight genetic algorithm. Designed for GitHub Pages; no backend or build step is required.

## Run locally
Because this project uses JavaScript modules, serve the folder through a local web server (do not open `index.html` as a `file://` URL).

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000>.

## Deploy to GitHub Pages
1. Create a GitHub repository and upload the contents of this folder.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select `main` and `/ (root)`, then Save.
5. Wait for the Pages URL to become available.

Three.js is loaded from jsDelivr, so the deployed page needs an internet connection.

## Controls
- Start evolution: begin AI generations.
- Pause / Resume: pause the simulation.
- Reset: restart with fresh random genomes.
- Sim speed: adjust simulation time.
- Population: choose 40–160 drones.
- Manual Pilot: arrow keys control pitch/roll; W/S throttle; A/D yaw.
- Chase / FPV: switch camera.

## How the learning works
Each drone has a small feed-forward neural network (10 inputs → 12 hidden units → 4 outputs). A genetic algorithm evaluates forward progress, speed, and finishing; keeps elite genomes; then applies tournament selection, crossover, and mutation to produce the next generation.

The drone uses a simplified 3D quadcopter-inspired flight model with attitude response, thrust, gravity, drag, and a speed limit. It is an educational simulation rather than a high-fidelity aerodynamic or real-world flight model.

## Notes
- The current track is a fixed square-section tunnel with a curved 3D centerline.
- Training happens in the browser tab and is not shared between visitors.
- Best genome/history are session-only in this starter build; browser persistence/export can be added next.
