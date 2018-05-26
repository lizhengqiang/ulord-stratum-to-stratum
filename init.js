// const client = require('stratum-client');
// client({
//     server: "cn.ulord-pool.com",
//     port: 7100,
//     worker: "ImProxy",
//     autoReconnectOnError: true,
//     onConnect: () => console.log('Connected to server'),
//     onClose: () => console.log('Connection closed'),
//     onError: (error) => console.log('Error', error.message),
//     onAuthorize: () => console.log('Worker authorized'),
//     onNewDifficulty: (newDiff) => console.log('New difficulty', newDiff),
//     onSubscribe: (subscribeData) => console.log('[Subscribe]', subscribeData),
//     onNewMiningWork: (newWork) => console.log('[New Work]', newWork),
// });

var stratum = require('stratum-pool/lib/stratum.js');
var options = {


    /* Some miner apps will consider the pool dead/offline if it doesn't receive anything new jobs
       for around a minute, so every time we broadcast jobs, set a timeout to rebroadcast
       in this many seconds unless we find a new job. Set to zero or remove to disable this. */
    "jobRebroadcastTimeout": 55,

    //instanceId: 37, //Recommend not using this because a crypto-random one will be generated

    /* Some attackers will create thousands of workers that use up all available socket connections,
       usually the workers are zombies and don't submit shares after connecting. This features
       detects those and disconnects them. */
    "connectionTimeout": 600, //Remove workers that haven't been in contact for this many seconds

    /* Sometimes you want the block hashes even for shares that aren't block candidates. */
    "emitInvalidBlockHashes": false,

    /* Enable for client IP addresses to be detected when using a load balancer with TCP proxy
       protocol enabled, such as HAProxy with 'send-proxy' param:
       http://haproxy.1wt.eu/download/1.5/doc/configuration.txt */
    "tcpProxyProtocol": false,

    /* If a worker is submitting a high threshold of invalid shares we can temporarily ban their IP
       to reduce system/network load. Also useful to fight against flooding attacks. If running
       behind something like HAProxy be sure to enable 'tcpProxyProtocol', otherwise you'll end up
       banning your own IP address (and therefore all workers). */
    "banning": {
        "enabled": true,
        "time": 600, //How many seconds to ban worker for
        "invalidPercent": 50, //What percent of invalid shares triggers ban
        "checkThreshold": 500, //Check invalid percent when this many shares have been submitted
        "purgeInterval": 300 //Every this many seconds clear out the list of old bans
    },

    /* Each pool can have as many ports for your miners to connect to as you wish. Each port can
       be configured to use its own pool difficulty and variable difficulty settings. varDiff is
       optional and will only be used for the ports you configure it for. */
    "ports": {
        "3032": { //A port for your miners to connect to
            "diff": 32, //the pool difficulty for this port

            /* Variable difficulty is a feature that will automatically adjust difficulty for
               individual miners based on their hashrate in order to lower networking overhead */
            "varDiff": {
                "minDiff": 8, //Minimum difficulty
                "maxDiff": 512, //Network difficulty will be used if it is lower than this
                "targetTime": 15, //Try to get 1 share per this many seconds
                "retargetTime": 90, //Check to see if we should retarget every this many seconds
                "variancePercent": 30 //Allow time to very this % from target without retargeting
            }
        },
        "3256": { //Another port for your miners to connect to, this port does not use varDiff
            "diff": 256 //The pool difficulty
        }
    },

    /* Recommended to have at least two daemon instances running in case one drops out-of-sync
       or offline. For redundancy, all instances will be polled for block/transaction updates
       and be used for submitting blocks. Creating a backup daemon involves spawning a daemon
       using the "-datadir=/backup" argument which creates a new daemon instance with it's own
       RPC config. For more info on this see:
          - https://en.bitcoin.it/wiki/Data_directory
          - https://en.bitcoin.it/wiki/Running_bitcoind */
    "daemons": [],


    /* This allows the pool to connect to the daemon as a node peer to receive block updates.
       It may be the most efficient way to get block updates (faster than polling, less
       intensive than blocknotify script). It requires the additional field "peerMagic" in
       the coin config. */
    "p2p": {
        "enabled": false,

        /* Host for daemon */
        "host": "127.0.0.1",

        /* Port configured for daemon (this is the actual peer port not RPC port) */
        "port": 19333,

        /* If your coin daemon is new enough (i.e. not a shitcoin) then it will support a p2p
           feature that prevents the daemon from spamming our peer node with unnecessary
           transaction data. Assume its supported but if you have problems try disabling it. */
        "disableTransactions": true

    }

};
var stratumServer = new stratum.Server(options, function () {
    console.log(arguments)
});

stratumServer.on('started', function () {
    //options.initStats.stratumPorts = Object.keys(options.ports);
    stratumServer.broadcastMiningJobs(jobManager.currentJob.getJobParams());
    finishedCallback();

}).on('broadcastTimeout', function () {
    emitLog('No new blocks for ' + options.jobRebroadcastTimeout + ' seconds - updating transactions & rebroadcasting work');

    GetBlockTemplate(function (error, rpcData, processedBlock) {
        if (error || processedBlock) return;
        jobManager.updateCurrentJob(rpcData);
    });

}).on('client.connected', function (client) {
    if (typeof (varDiff[client.socket.localPort]) !== 'undefined') {
        varDiff[client.socket.localPort].manageClient(client);
    }

    client.on('difficultyChanged', function (diff) {
        emit('difficultyUpdate', client.workerName, diff);

    }).on('subscription', function (params, resultCallback) {

        var extraNonce = jobManager.extraNonceCounter.next();

        resultCallback(null,
            extraNonce
        );

        if (typeof (options.ports[client.socket.localPort]) !== 'undefined' && options.ports[client.socket.localPort].diff) {
            this.sendDifficulty(options.ports[client.socket.localPort].diff);
        } else {
            this.sendDifficulty(8);
        }

        this.sendMiningJob(jobManager.currentJob.getJobParams());

    }).on('login', function (params, resultCallback) {

        var extraNonce = jobManager.extraNonceCounter.next();
        resultCallback(null, extraNonce);

        if (typeof (options.ports[client.socket.localPort]) !== 'undefined' && options.ports[client.socket.localPort].diff) {
            this.sendDifficulty(options.ports[client.socket.localPort].diff);
            /* surely we should send target instead of diff, in job params */
            /* how to convert diff to target... */
            /**/
        } else {
            this.sendDifficulty(8);
        }

        /* this.sendMiningJob(jobManager.currentJob.getJobParams()); */
        this.sendMiningJob(jobManager.currentJob.getJobParams());

    }).on('submit', function (params, resultCallback) {

        /* console.log("diff: " + client.difficulty);*/

        var result = jobManager.processSecondShare(
            params.jobId,
            client.previousDifficulty,
            client.difficulty,
            client.remoteAddress,
            client.socket.localPort,
            params.name,
            params.nTime,
            params.nonce,
            null,
            null,
            null
        );

        resultCallback(result.error, result.result ? true : null);

    }).on('secondSubmit', function (params, resultCallback) {

        /* console.log("diff: " + client.difficulty);*/

        var result = jobManager.processSecondShare(
            params.jobId,
            client.previousDifficulty,
            client.difficulty,
            client.remoteAddress,
            client.socket.localPort,
            params.name,
            null,
            null,
            client.extraNonce1,
            params.nonce,
            params.hash
        );

        resultCallback(result.error, result.result ? true : null);

    }).on('malformedMessage', function (message) {
        emitWarningLog('Malformed message from ' + client.getLabel() + ': ' + message);

    }).on('socketError', function (err) {
        emitWarningLog('Socket error from ' + client.getLabel() + ': ' + JSON.stringify(err));

    }).on('socketTimeout', function (reason) {
        emitWarningLog('Connected timed out for ' + client.getLabel() + ': ' + reason)

    }).on('socketDisconnect', function () {
        //emitLog('Socket disconnected from ' + client.getLabel());

    }).on('kickedBannedIP', function (remainingBanTime) {
        emitLog('Rejected incoming connection from ' + client.remoteAddress + ' banned for ' + remainingBanTime + ' more seconds');

    }).on('forgaveBannedIP', function () {
        emitLog('Forgave banned IP ' + client.remoteAddress);

    }).on('unknownStratumMethod', function (fullMessage) {
        emitLog('Unknown stratum method from ' + client.getLabel() + ': ' + fullMessage.method);

    }).on('socketFlooded', function () {
        emitWarningLog('Detected socket flooding from ' + client.getLabel());

    }).on('tcpProxyError', function (data) {
        emitErrorLog('Client IP detection failed, tcpProxyProtocol is enabled yet did not receive proxy protocol message, instead got data: ' + data);

    }).on('bootedBannedWorker', function () {
        emitWarningLog('Booted worker ' + client.getLabel() + ' who was connected from an IP address that was just banned');

    }).on('triggerBan', function (reason) {
        emitWarningLog('Banned triggered for ' + client.getLabel() + ': ' + reason);
        emit('banIP', client.remoteAddress, client.workerName);
    });
});
