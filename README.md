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
```
