var exec = require("./exec");
var StdError = exec.StdError;
var R = require("ramda");

function DockerMachineError(message) {
  this.message = message;
  this.stack = (new Error()).stack;
}

DockerMachineError.prototype = Object.create(Error.prototype);
DockerMachineError.prototype.constructor = DockerMachineError;
DockerMachineError.prototype.name = "DockerMachineError";

var status = function (machineName) {
  return exec('docker-machine status ' + machineName);
};

var start = function (machineName) {
  return status(machineName)
    .then(function (status) {
      if (status == "Error") {
        throw new DockerMachineError('Docker Machine "' + machine + '" is in error state.');
      } else if (status !== "Running") {
        console.log('Starting machine: ' + machineName);
        return exec('docker-machine start ' + machineName)
          .catch(StdError, function (err) {
            var code = err.code,
                msg = err.message;
            throw new DockerMachineError(
              'Can\'t start machine. Error <'+ code + '>: ' + msg
            );
          });
      }
    })
};

var inspect = function (machineName) {
  return exec('docker-machine inspect ' + machineName)
    .then(JSON.parse);
}

var vmExec = function (machineName, command) {
  var cmd = 'docker-machine ssh ' + machineName + ' ' + command;
  return exec(cmd);
};

var rsync = function (machineName, config, hostDir, vmDir, exclude) {

  var remotePath = [
    config.info.Driver.SSHUser + '@' + config.ip_address,
    ':',
    vmDir,
    '/'
  ].join('');

  var cmd = [
    'cd', hostDir, '&&',
    'rsync --recursive --delete --relative --verbose',
    '--rsh "ssh -i ' + config.info.Driver.SSHKeyPath + ' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"',
    '.', remotePath
  ];

  if (exclude) {
    cmd = R.reduce(function (c, ex) {
      c.push('--exclude \'' + ex + '\'');
      return c;
    }, cmd, exclude);
  }

  return exec(cmd.join(" "), false);
};

var mkdir = function (machineName, dir, chmod) {
  var m = vmExec(machineName, 'sudo mkdir -p ' + dir);
  if (chmod && chmod.length) {
    m.then(function () {
       return vmExec(machineName, 'sudo chmod -R ' + chmod + ' ' + dir);
    });
  }
  return m;
};

module.exports = {
  status: status,
  // To be removed. User should be responsible that the machine is up and
  // running.
  start: start,
  inspect: inspect,
  exec: vmExec,
  rsync: rsync,
  mkdir: mkdir,
  DockerMachineError: DockerMachineError
};
