var fs = require('fs-extra'),
    sforceCI = require('./sforceCI')

var envFileName = 'environment.json';
var environment = JSON.parse(fs.readFileSync(envFileName, 'utf8'));
environment.updateInProgress = true;
updateEnvironment(environment);
var startedDate = new Date();
//console.dir(environment);

function main() {
  console.log("start sforceCI at: "+ startedDate);

  if (environment.useCron) {
    console.log("using cronPattern: " + environment.cronPattern);
    var cronJob = require('cron').CronJob;
    var job = new cronJob(environment.cronPattern, function(){
      environment = JSON.parse(fs.readFileSync(envFileName, 'utf8'));
      startedDate = new Date();
      console.log("start sforceCI at: "+ startedDate);
      resetCallbacks();
      processOrgs(environment.orgs, function(err){
        environment.updateInProgress = false;
        environment.lastRunDate = startedDate.toJSON();
        updateEnvironment(environment);
        console.log("finish sforceCI at: " + new Date());
        console.log("continuing with cronPattern: " + environment.cronPattern);
      });
      }, function () {
        // This function is executed when the job stops
        console.log('cron stop');
      },
      true /* Start the job right now */,
      environment.timezone
    );
  } else {
    processOrgs(environment.orgs, function(err){
      environment.updateInProgress = false;
      environment.lastRunDate = startedDate.toJSON();
      updateEnvironment(environment);
      console.log("finish sforceCI at: " + new Date());
    });
  }
}

var sforceCIReturned = 0;
var sforceCIFinished = null;
var sforceCIOrgs = [];
function sforceCICallback(err, runDate) {
  if (err) { 
    console.log(err);
    var runError = new Error(err);
    throw runError;
  }
  //console.log(runDate);
  if (runDate) { environment.orgs[sforceCIReturned].lastRunDate = runDate.toJSON(); }
  sforceCIReturned++;
  console.log('sforceCICallback processed %s of %s', sforceCIReturned, sforceCIOrgs.length);

  if (sforceCIOrgs.length == sforceCIReturned) {
    sforceCIFinished(null);
  } else {
    sforceCI.process(sforceCIOrgs[sforceCIReturned], sforceCICallback);
  }
}

function processOrgs(orgs, callback) {
  sforceCIFinished = callback;
  sforceCIOrgs = orgs;
  sforceCI.process(orgs[0], sforceCICallback);
}

function updateEnvironment(environment) {
  var environmentJson = JSON.stringify(environment, null, 2);
  fs.writeFileSync(envFileName, environmentJson, 'utf8');
}

function resetCallbacks() {
  sforceCIReturned = 0;
  sforceCIFinished = 0;
  sforceCIOrgs = [];
}

main();