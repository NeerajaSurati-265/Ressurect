const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('hello from express'));
app.listen(5000, () => console.log('listening on 5000'));
