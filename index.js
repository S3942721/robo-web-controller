const express = require("express");
const {join} = require("path")

const app = express();

app.use(require("body-parser").json())
app.use(require("cors")())

const router = express.Router();

app.use(express.static(join(__dirname, 'dist')));

router.get("*", (req, res)=>{
    res.redirect(join(__dirname, 'dist', 'index.html'));
})

app.use('/', router);

app.listen(3000, '0.0.0.0', () => {
    console.log("Server is listening on port 3000!")
})