#!/usr/bin/env node

var minimist = require("minimist");

var args = minimist(process.argv.splice(1), {
  string: 'machine',
  string: 'dir',
  default: {
    dir: process.env.PWD,
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
var watch = require("watch");
var chokidar = require("chokidar");


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
    rsyncs.push(dockerMachine.rsync(
      machine,
      volumeDef.dir,
      volumeDef.vm_dir,
      volumeDef.exclude
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
      return dockerMachine.rsync( machine, volumeDef.dir, volumeDef.vm_dir, volumeDef.exclude)
        .then(function() {
          console.log(' >', volumeDef.dir, '=>', volumeDef.vm_dir, 'synced.');
        });
    }, 3000);
    var watcher = chokidar.watch('.', {
      cwd: volumeDef.dir,
      ignored: volumeDef.exclude,
      awaitWriteFinish: true
    });
    watcher.on('all', function (e, p) {
      debouncedRsync(volumeDef);
    });
  })
  return config;
};



dockersyncConfig.fromFile(configFile)
  .then(function(config) {
    config.machine = args.machine || config.machine;
    return config;
  })
  .then(startMachine)
  .then(createVolumesInVm)
  .then(initialRsync)
  .then(startFileWatchers)
  .catch(StdError, function(err) {
    console.error(err.message);
    console.error(err.stack);
  })
  .catch(function (err) {
    console.error(err.message);
    console.error(err.stack);
  });

