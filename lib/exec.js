var Promise = require("bluebird");
var shelljs = require("shelljs");

function StdError(error, code, stdout) {
  this.message = error;
  this.code = code;
  this.stdout = stdout;
  var err = new Error();
  this.stack = err.stack;
}

StdError.prototype = Object.create(Error.prototype);
StdError.prototype.constructor = StdError;
StdError.prototype.name = "StdError";

var exec = function(command, silent) {
  silent = (typeof silent == "undefined" || silent == true);
  return new Promise(function(resolve, reject) {
    var child = shelljs.exec(command, { silent: silent } , function(code, stdout, stderr) {
      stdout = String(stdout);
      stdout = stdout.trim();
      stdout.child_process = child;
      if (code) {
        reject(new StdError(String(stderr), code, stdout))
      } else {
        resolve(stdout);
      }
    })
  });
}

exec.StdError = StdError;
module.exports = exec;

