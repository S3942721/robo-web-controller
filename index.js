const express = require("express");
const {join} = require("path")

const app = express();

app.use(require("body-parser").json())
app.use(require("cors")())

const router = express.Router();

router.get("/", (req, res)=>{
    res.sendFile(join(__dirname, 'index.html'))
})

app.use('/', router);

app.listen(3000, '0.0.0.0', () => {
    console.log("Server is listening on port 3000!")
})