const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// in-mem for now. Will update to something per persistent
const customers = [];

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send('Hello World!');
});

app.post('/api/customers', (req, res) => {
    console.log(req.body);

    const { name, partySize } = req.body;
    
    const newCustomer = {
        id: customers.length + 1,
        name,
        partySize,
        status: 'waiting'
    };

    customers.push(newCustomer);

    // calculate position. we might need another algorithm in the future
    const position = customers.filter(c => c.status === 'waiting').length - 1;

    res.json({
        id: newCustomer.id,
        position
    });
})

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});