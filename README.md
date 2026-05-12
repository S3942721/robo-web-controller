## Robot Web Controller
This project is for control the pepper robot, using socket to establish connection and send events handle by Pepper Robot
## Build & Start
> Please make sure you have `Node.JS` installed.

This project has 2 parts, requires to install dependencies independently.  
Dependencies are managed by `pnpm`, you can use any package manager you want.  
After clone the project, please run
```sh
cd frontend
pnpm install
cd ..
pnpm install
pnpm run build-start
```
to build frontend and run the server.  
Here are some other commands might be useful for development:
```sh
# inside /frontend
npm run dev # start the frontend app
npm run build # build the frontend app
# inside root
npm run start # start the server
npm run dev # start a dev server using nodemon, this will automatically restart when you made some change.
npm run build # same as run build inside /frontend 

## Tablet heartbeat and reload

The tablet pages (`/public/tablet.html` and `/public/tablet-techy.html`) now send a heartbeat to the server every 5 seconds so the backend can detect staleness and optionally auto-reload the robot's webview.

- Heartbeat endpoint: `POST /api/robot-tablet/heartbeat` with JSON body `{ "robot": "Haku" }`
- Status: `GET /api/robot-tablet/status`
- Manual reload: `POST /api/robot-tablet/reload/:robot`

Env vars:
- `TABLET_HEARTBEAT_TIMEOUT_MS` (default 30000)
- `TABLET_AUTO_RELOAD` (default true)
- `TABLET_RELOAD_COOLDOWN_MS` (default 60000)
- `PUBLIC_BASE_URL` (optional e.g. `http://10.0.0.3:3000`) for absolute reload URLs

Robot integration: the server sends `{ type: 'control', action: 'reload_tablet', url, path }` to the robot. The robot should reload the embedded webview to `url` if absolute `PUBLIC_BASE_URL` is set, otherwise use `path` with its known server host.
```
