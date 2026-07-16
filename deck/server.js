// server.js
const io = require('socket.io')(3000, {
    cors: { origin: "*" }
});

let gameState = {};

io.on('connection', socket => {

    console.log('User connected:', socket.id);

    socket.on('joinGame', () => {
        socket.join('room1');
    });

    socket.on('playCard', data => {
        // Broadcast to all players
        io.to('room1').emit('cardPlayed', data);
    });

    socket.on('dealCards', data => {
        io.to('room1').emit('cardsDealt', data);
    });
});