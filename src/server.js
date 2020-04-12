import sirv from 'sirv';
import polka from 'polka';
import http from 'http';
import io from 'socket.io';
import compression from 'compression';
import * as sapper from '@sapper/server';

const WebSocket = require('ws');
const cors = require('cors');

process.env.PORT = process.env.PORT || 3000;

const { PORT, NODE_ENV } = process.env;
const WEBSOCKET_PORT = 3001;
const dev = NODE_ENV === 'development';

let spigotWs;

var playerNames = new Map();
var playerTokens = new Map();

var channels = {};
var sockets = {};

var playerSockets = {};
var playerUUIDs = {};
var playersConnected = new Set();

const server = http.createServer();

const securityMiddleware = (_, res, next) => {
    res.setHeader("Content-Security-Policy", "script-src 'self'");
    return next();
};

const app = polka({ server }) // You can also use Express
	.use(
		compression({ threshold: 0 }),
		sirv('static', { dev }),
        sapper.middleware(),
        cors(),
        //securityMiddleware
    )
	.listen(PORT, err => {
        if (err) {
            console.log('error', err);
            return;
        }
          
        console.log("Socket IO Voice socket listening on https://localhost:" + PORT + "/voice");
        console.log("User Audio Data socket listening on https://localhost:" + WEBSOCKET_PORT + "/");
    });

const wss = new WebSocket.Server({ port: WEBSOCKET_PORT });

const disconnectClient = (socket) => {
    console.log("Disconnecting client..");
    for (var channel in socket.channels) {
        partChannel(socket, channel);
    }
    console.log("["+ socket.id + "] disconnected");
    const playerUUID = playerUUIDs[socket.id];

    delete sockets[socket.id];
    playersConnected.delete(playerUUID);
    delete playerUUIDs[socket.id];
    delete playerSockets[playerUUID];

    if(spigotWs) {
        spigotWs.send(JSON.stringify({ event: 'DISCONNECT' , playerUUID }));
    }
};

const partChannel = (socket, channel) => {
    console.log("["+ socket.id + "] part ");

    if (!(channel in socket.channels)) {
        console.log("["+ socket.id + "] ERROR: not in ", channel);
        return;
    }

    delete socket.channels[channel];
    delete channels[channel][socket.id];

    for (let id in channels[channel]) {
        channels[channel][id].emit('removePeer', {'peer_id': socket.id});
        socket.emit('removePeer', {'peer_id': id});
    }
};

wss.on('connection', function connection(ws, req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log(ip);
    
    //if ip does not match : return ws.terminate();

    console.log('connected to client');
    spigotWs = ws;

    ws.on('message', function incoming(message) {
        const messageJson = JSON.parse(message);

        if(messageJson.token) {
            const { player, playerName, token } = messageJson;
            console.log("Received token: " + token + " for player " + playerName + " with UUID " + player + "!");

            playerNames.set(player, playerName);
            playerTokens.set(token, player);
            return;
        }

        if(messageJson.invalidateToken) {
            const { invalidateToken } = messageJson;
            console.log("Received invalidate token: " + invalidateToken + "!");

            if(!invalidateToken || !invalidateToken in playerTokens) {
                return;
            }

            const playerUUID = playerTokens.get(invalidateToken);
            if(!playerUUID || !playerUUID in playerSockets) {
                return;
            }

            playerTokens.delete(invalidateToken);
            
            const socketId = playerSockets[playerUUID];
            if(!socketId || !socketId in sockets) {
                return;
            }

            console.log("Closing socket connection..");

            const socket = sockets[socketId];
            disconnectClient(socket);
            socket.emit('invalidToken');
            return;
        }

        const { player, microphoneActivated, volumes } = messageJson;
        let socketId = playerSockets[player];

        if(socketId in sockets) {
            const volumesWithSocketId = volumes.map((volume) => {
                return {
                    ...volume,
                    playerName: playerNames.get(volume.player),
                    socketId: playerSockets[volume.player],
                }
            }); 
            sockets[socketId].emit('volumes', { microphoneActivated, volumes: volumesWithSocketId });
        }
        //console.log('received: %s', message);
    });
});

/**
 * Users will connect to the signaling server, after which they'll issue a "join"
 * to join a particular channel. The signaling server keeps track of all sockets
 * who are in a channel, and on join will send out 'addPeer' events to each pair
 * of users in a channel. When clients receive the 'addPeer' even they'll begin
 * setting up an RTCPeerConnection with one another. During this process they'll
 * need to relay ICECandidate information to one another, as well as SessionDescription
 * information. After all of that happens, they'll finally be able to complete
 * the peer connection and will be streaming audio/video between eachother.
 */
io(server).of("/voice").on('connection', function (socket) {
    socket.channels = {};
    sockets[socket.id] = socket;

    console.log("["+ socket.id + "] connection accepted");

    socket.on('disconnectClient', function () {
        console.log("Disconnecting due to client request!");
        disconnectClient(socket);
    });

    socket.on('disconnect', function () {
        disconnectClient(socket);
    });

    socket.on('join', function (config) {
        console.log("["+ socket.id + "] join ", config);
        var channel = config.channel;
        var userdata = config.userdata;
        const { playerToken } = userdata;

        if(!playerTokens.get(playerToken)) {
            console.log("["+ socket.id + "] ERROR: Token invalid!");

            disconnectClient(socket);
            socket.emit('invalidToken');
            return;
        }

        const playerUUID = playerTokens.get(playerToken);

        if (channel in socket.channels || playersConnected.has(playerUUID)) {
            console.log("["+ socket.id + "] ERROR: already joined ", channel, channel in socket.channels);
            disconnectClient(socket);
            return;
        }

        playerSockets[playerUUID] = socket.id;
        playerUUIDs[socket.id] = playerUUID;
        playersConnected.add(playerUUID);

        if (!(channel in channels)) {
            channels[channel] = {};
        }

        for (let id in channels[channel]) {
            channels[channel][id].emit('addPeer', {'peer_id': socket.id, 'should_create_offer': false});
            socket.emit('addPeer', {'peer_id': id, 'should_create_offer': true});
        }

        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;

        if(spigotWs) {
            console.log("Emitting connected signal to MC server for player " + playerUUID + "..");
            spigotWs.send(JSON.stringify({ event: 'CONNECT' , playerUUID }));
        }
    });

    function part(channel) {
        partChannel(socket, channel);
    }
    socket.on('part', part);

    socket.on('relayICECandidate', function(config) {
        var peer_id = config.peer_id;
        var ice_candidate = config.ice_candidate;
        console.log("["+ socket.id + "] relaying ICE candidate to [" + peer_id + "] ", ice_candidate);

        if (peer_id in sockets) {
            sockets[peer_id].emit('iceCandidate', {'peer_id': socket.id, 'ice_candidate': ice_candidate});
        }
    });

    socket.on('relaySessionDescription', function(config) {
        var peer_id = config.peer_id;
        var session_description = config.session_description;
        console.log("["+ socket.id + "] relaying session description to [" + peer_id + "] ", session_description);

        if (peer_id in sockets) {
            sockets[peer_id].emit('sessionDescription', {'peer_id': socket.id, 'session_description': session_description});
        }
    });
});

export default app;