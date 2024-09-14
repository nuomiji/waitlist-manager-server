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

app.get('/', (_, res) => {
    res.status(200).send('Hello World!');
});

app.get('/api/customers/:id', (req, res) => {
    const { id } = req.params;
    console.log(`Incoming get request for id ${id}`);
    
    // need to implement a better way to retrieve customer when we implement data store
    const customer = customers.find(c => c.id == id);

    if (customer) {
        const position = customers.filter(c => inQueue(c) && c.id < customer.id).length;
        console.log(`Found customer. Name: ${customer.name}, Position: ${position}`);

        // this is a wordaround. currently this is only updated when a client fetches details
        // we will need to trigger this on server side in the future
        if (position === 0 && customer.status === 'waiting') {
            customer.status = 'tableReady';
        }

        res.json({
            id: customer.id,
            name: customer.name,
            partySize: customer.partySize,
            status: customer.status,
            position
        });
    } else {
        console.log('No customer found');
        res.status(404).json({ message: 'Customer not found'});
    }
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
    const position = customers.filter(inQueue).length - 1;

    res.json({
        id: newCustomer.id,
        position
    });
});

app.put('/api/customers/:id/check-in', (req, res) => {
    const { id } = req.params;
    const customer = customers.find(c => c.id == id); // this needs to be loose comparison because we are comparing string to number

    if (customer?.status === 'tableReady') {
        customer.status = 'seated';
        // todo: add customer to seat queue
        res.json({ message: `Customer ${id} checked in and seated`});
    } else {
        res.status(404).json({ message: 'Customer not ready or already seated'});
    }
})

function inQueue(c) {
    return c.status === 'waiting' || c.status === 'tableReady';
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});