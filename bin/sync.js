#!/usr/bin/env node

var minimist = require("minimist");

var args = minimist(process.argv.splice(1), {
  string: ['machine', 'dir'],
  boolean: ['initial-only', 'sync-only'],
  alias: {
    machine: 'm',
    dir: 'd',
    'initial-only': 'i',
    'sync-only': 's',
  },
  default: {
    dir: process.env.PWD,
    initial: false,
    'sync-only': false
  }
});

var path = require("path");
var R = require("ramda");
var fs = require("fs");
var dockersyncConfig = require("../lib/dockersync-config");
var debounce = require("lodash.debounce");
var dockerMachine = require('../lib/docker-machine');
var exec = require('../lib/exec');
var StdError = exec.StdError;
var Promise = require("bluebird");
var nhokidar = require("chokidar");


var log = R.tap(console.log);

var configFile = path.join(args.dir, 'dockersync.yml');

if (!fs.existsSync(configFile)) {
  console.error("Can't find dockersync.yml in " + args.dir);
  process.exit(1);
};

var startMachine = function (config) {
  return dockerMachine.start(config.machine).then(R.always(config));
};

var createVolumesInVm = function (config) {
  var machine = config.machine;
  var mkdirs = [];

  dockersyncConfig.mapMounts(config, function (volumeDef, service, mount) {
    console.log(machine + '[' + service + ']: ensuring that ' + volumeDef.vm_dir + ' exists ...');
    mkdirs.push(dockerMachine.mkdir(machine, volumeDef.vm_dir, '0775').then(function () {
      console.log(' > ' + volumeDef.vm_dir + ' created.');
    }));
    return volumeDef;
  });

  return Promise.all(mkdirs).then(R.always(config));
};

var initialRsync = function (config) {

  var machine = config.machine;
  var rsyncs = [];

  dockersyncConfig.mapMounts(config, function(volumeDef, service, mount) {
    console.log( machine + '[' + service + ']:', 'syncing files',
      volumeDef.dir, '=>', volumeDef.vm_dir, '...'
    );

    var exclude = volumeDef.exclude.map(function (ex) {
      return path.join(ex, '/**/*');
    });

    rsyncs.push(dockerMachine.rsync(
      machine,
      config,
      volumeDef.dir,
      volumeDef.vm_dir,
      exclude
    ));

    return volumeDef;
  });

  return Promise.all(rsyncs).then(R.always(config));
}

var startFileWatchers = function (config) {
  var watchers = [];
  var machine = config.machine;

  dockersyncConfig.mapMounts(config, function(volumeDef, service, mount) {
    console.log(' >', 'watching', volumeDef.dir, 'for changes', '...');
    var debouncedRsync = debounce(function(volumeDef) {
      console.log(machine + '[' + service + ']', 'files changed!');
      console.log('syncing', volumeDef.dir, '=>', volumeDef.vm_dir, '...');
      return dockerMachine.rsync(machine, config, volumeDef.dir, volumeDef.vm_dir, volumeDef.exclude)
        .then(function() {
          console.log(' >', volumeDef.dir, '=>', volumeDef.vm_dir, 'synced.');
        }).catch(StdError, function (err) {
          console.log('Error when syncing files:');
          console.error(err.message);
          console.error(err.stack);
        });
    }, 1000);

    var watcher = chokidar.watch('.', {
      ignoreInitial: true,
      cwd: volumeDef.dir,
      ignored: volumeDef.exclude,
      awaitWriteFinish: true
    });

    watcher.on('all', function (e, p) {
      debouncedRsync(volumeDef);
    });

  });

  return config;
};

var gatherMachineInfo = function (config) {
  return dockerMachine.inspect(config.machine)
    .then(R.compose(R.assoc('info', R.__, config)))
    .then(function (config) {
      return exec('docker-machine ip ' + config.machine)
        .then(R.assoc('ip_address', R.__, config));
    })
};

var flow = dockersyncConfig.fromFile(configFile)
  .then(function(config) {
    config.machine = args.machine || config.machine;
    return config;
  })
  .then(startMachine)
  .then(gatherMachineInfo)
  .then(createVolumesInVm);

if (args['initial-only'] == true || (args['initial-only'] == false && args['sync-only'] == false)) {
  flow = flow.then(initialRsync);
}

if (args['sync-only'] == false && args['initial-only'] == false) {
  flow = flow.then(function (config) {
    if (config.command) {
      console.log('Executing command:');
      console.log(' > ' + config.command);
      return exec(config.command).then(R.always(config));
    }
    return config;
  });
}

if (args['sync-only'] == true || (args['initial-only'] == false && args['sync-only'] == false)) {
  flow = flow.then(startFileWatchers);
}

flow.catch(StdError, function(err) {
    console.error(err.message);
    console.error(err.stack);
  })
  .catch(function (err) {
    console.error(err.message);
    console.error(err.stack);
  });

