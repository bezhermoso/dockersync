var Promise = require("bluebird");
var fs = Promise.promisifyAll(require("fs"));
var R = require("ramda");
var yaml = require("js-yaml");

var mountDef = {
  dir: null,
  vm_dir: null,
  container_dir: null,
  exclude: ['.git/**/*']
};

var fromFile = function (filename) {
  return fs.readFileAsync(filename)
    .then(String)
    .then(yaml.load)
    .then(R.merge({
      machine: 'default'
    }));
};

var mapMounts = function (config, fn) {
  return R.merge(config.services, {
    services: R.mapObjIndexed(function(mounts, service) {
      return R.mapObjIndexed(function(mountDefinitions, mount) {
        return fn(mountDefinitions, service, mount);
      }, mounts);
    }, config.services)
  })
};

module.exports = {
  fromFile: fromFile,
  mapMounts: mapMounts
};
