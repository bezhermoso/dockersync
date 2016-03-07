var Promise = require("bluebird");
var fs = Promise.promisifyAll(require("fs"));
var R = require("ramda");
var yaml = require("js-yaml");

var fromFile = function (filename) {
  return fs.readFileAsync(filename)
    .then(String)
    .then(yaml.load)
    .then(function (data) {
      if (data.version && data.version == 2) {
        return data;
      } else {
        throw new Error('This only support YAML files declaring API v2.');
      }
    });
};

module.exports = {
  fromFile: fromFile
};
