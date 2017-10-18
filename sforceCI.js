
var fs = require('fs-extra'),
    xml2js = require('xml2js'),
    uuid = require('node-uuid'),
    decompress = require('decompress'),
    jsforce = require('jsforce'),
    svnClient = require('svn-spawn')

var isProfiles = false;
var conn = null;
var env = null
var startedDate = null;
var tempFolder = '/unpackaged';

var metaTypes = [ 
'ActionLinkGroupTemplate',
'AnalyticSnapshot',
'ApexComponent',
'ApexTestSuite',
'ApexTrigger',
'AppMenu',
'ApprovalProcess',
'AssignmentRules',
'AuraDefinitionBundle',
'AuthProvider',
'AutoResponseRules',
'BrandingSet',
'CallCenter',
'CampaignInfluenceModel',
'CaseSubjectParticle',
'ChannelLayout',
'ChatterExtension',
'CleanDataService',
'Community',
'CommunityTemplateDefinition',
'CommunityThemeDefinition',
'ContentAsset',
'CorsWhitelistOrigin',
'CspTrustedSite',
'CustomApplicationComponent',
'CustomFeedFilter',
'CustomLabels',
'CustomMetadata',
'CustomObjectTranslation',
'CustomPageWebLink',
'CustomPermission',
'CustomSite',
'CustomValue',
'DataCategoryGroup',
'DelegateGroup',
'DuplicateRule',
'EclairGeoData',
'EntitlementProcess',
'EntitlementTemplate',
'EscalationRules',
'EventDelivery',
'EventSubscription',
'ExternalDataSource',
'ExternalServiceRegistration',
'FlexiPage',
'Flow',
'GlobalPicklistValue',
'GlobalValueSet',
'GlobalValueSetTranslation',
'HomePageComponent',
'KeywordList',
'Letterhead',
'LiveChatAgentConfig',
'LiveChatButton',
'LiveChatDeployment',
'LiveChatSensitiveDataRule',
'ManagedTopics',
'MatchingRule',
'MilestoneType',
'ModerationRule',
'NamedCredential',
'Network',
'NetworkBranding',
'PathAssistant',
'PlatformCachePartition',
'Portal',
'PostTemplate',
'ProfilePasswordPolicy',
'Queue',
'QuickAction',
'RemoteSiteSetting',
'ReportType',
'Role',
'Scontrol',
'Settings',
'SharingCriteriaRule',
'SharingOwnerRule',
'SharingRules',
'SharingSet',
'SiteDotCom',
'Skill',
'StandardValueSet',
'StandardValueSetTranslation',
'StaticResource',
'SynonymDictionary',
'Territory',
'Territory2',
'Territory2Model',
'Territory2Rule',
'Territory2Type',
'TopicsForObjects',
'TransactionSecurityPolicy',
'Translations',
'UserCriteria',
'WaveApplication',
'WaveDashboard',
'WaveDataflow',
'WaveDataset',
'WaveLens',
'WaveTemplateBundle',
'Wavexmd',
'Workflow'
 ];

var profileMetaTypes = [ 'Profile', 'PermissionSet', 'CustomObject', 'Layout', 'CustomTab', 'CustomApplication', 'ApexClass', 'ApexPage', 'HomePageLayout'];

function process(args, callback) {
  env = args;
  startedDate = new Date();
  isProfiles = false;
  resetCallbacks();
  console.log('start org - ' + env.name);
  if (!env.isActive) {
    return callback('inactive - ' + env.name, null);
  }

  if (env.excludeProfiles != null && env.excludeProfiles) {
    //or like EcoLab has a performance issue
    console.log("Excluding Profiles");
    profileMetaTypes = ['CustomObject', 'Layout', 'CustomTab', 'CustomApplication', 'ApexClass', 'ApexPage', 'HomePageLayout' ];
  }

  if (env.isSandbox) {
    conn = new jsforce.Connection({
      loginUrl : 'https://test.salesforce.com'
    });
  } else {
    conn = new jsforce.Connection();
  }
  conn.metadata.pollTimeout = 600000; //Polling timeout - 10 minutes
  conn.login(env.sforceUsername, env.sforcePassword + env.sforceSecurityToken, function(err, userInfo) {
    if (err) { 
      console.error(err);
      return callback('login issue - ' + env.name, null);
    }
    //console.log("accessToken: " + conn.accessToken);
    console.log("instanceUrl: " + conn.instanceUrl);
    console.log("userInfo.id: " + userInfo.id);
    console.log("userInfo.organizationId: " + userInfo.organizationId);

    console.log('start metalists');
    getMetalistFolders(function(folders) {
      getMetaLists(folders, function(metaLists) {
        console.log('finish metalists');
        buildRetrieveRequests(metaLists, function(requestData) {
          console.log('finish retrieve');
          fs.removeSync(env.svnPath + '/unpackaged/package.xml');
          fs.copySync(env.svnPath + tempFolder, env.svnPath + env.svnFolder);
          console.log("copied unpackaged to: " + env.svnFolder);
          if (env.diffPath != null) {
              fs.removeSync(env.diffPath);
              fs.mkdirSync(env.diffPath);
              fs.copySync(env.svnPath + tempFolder, env.diffPath);
              console.log("copied unpackaged to diffPath");
          }

          if (!env.keepTempFiles) {
            fs.removeSync(env.svnPath + tempFolder);
            console.log("removed unpackaged");
          }
          resetCallbacks();
          //process profiles
          isProfiles = true;
          getMetaLists(null, function(profileMetaLists) {
            console.log('finish profileMetalists');
            buildRetrieveRequests(profileMetaLists, function(requestData) {
              console.log('finish profileRetrieve');
              fs.removeSync(env.svnPath + '/unpackaged/package.xml');
              fs.copySync(env.svnPath + tempFolder, env.svnPath + env.svnFolder);
              console.log("copied unpackaged to: " + env.svnFolder);
              if (env.diffPath != null) {
                fs.copySync(env.svnPath + tempFolder, env.diffPath);
                console.log("copied unpackaged to diffPath: " + env.diffPath);
              }

              if (!env.keepTempFiles) {
                fs.removeSync(env.svnPath + tempFolder);
                console.log("removed unpackaged");
              }
              console.log('start svn');
              svnCommit(function(result) {
                console.log('finish svn');
                console.log('finish org - ' + env.name);
                return callback(null, result);
              });
            });
          });
        });
      });
    });
  });
}

function buildPackageFromXml() {
  //parses existing package.xml
  var parser = new xml2js.Parser();
  fs.readFile(env.svnPath + '/trunk/package.xml', function(err, data) {
    parser.parseString(data, function (err, result) {
      var retrievePackage = { types : result.Package.types };
      var retrieveRequest = { unpackaged : retrievePackage };
      retrieveMetadata(retrieveRequest);
    });
  });
}

function getMetalistFolders(callback) {
  if (false) {
    conn.metadata.describe(function(err, data) {
      if (err) { return console.error(err); }
      for (var i=0; i < data.metadataObjects.length; i++) {
        var meta = data.metadataObjects[i];
        //console.log("childXmlNames: " + meta.childXmlNames.join());
        console.log("directoryName: " + meta.directoryName);
        console.log("inFolder: " + meta.inFolder);
        console.log("metaFile: " + meta.metaFile);
        console.log("suffix: " + meta.suffix);
        console.log("xmlName: " + meta.xmlName);
        console.log("=================");
      }
    });
  }

  metaFolderCallback([
    function(next) { conn.metadata.list({ type : 'DashboardFolder' }, next); },
    function(next) { conn.metadata.list({ type : 'EmailFolder' }, next); },
    function(next) { conn.metadata.list({ type : 'ReportFolder' }, next); }
  ], callback);
}

function getMetaLists(results, callback) {
  metaListFinished = callback;

  var types = profileMetaTypes;

  if (results != null) {
    types = metaTypes;

    processFolders(results[0], 'Dashboard');
    processFolders(results[1], 'EmailTemplate');
    processFolders(results[2], 'Report');
  }

  for (var x=0; x < types.length; x++) {
    metaListCalls++;
    conn.metadata.list([ { type : types[x] } ], metaListCallback);
  }
}

function processFolders(data, type) {
  if (typeof data != 'undefined') {
      var staged = Array.isArray(data) ? data : [ data ];
      var folders = getFolderRequest(type, staged);
      
      for (var x=0; x < folders.length; x++) {
        metaListCalls++;
        conn.metadata.list([ folders[x] ], metaListCallback);
      }
    }
}

function buildRetrieveRequests(results, callback) {
  var lastRunDate = new Date();

  if (env.lastRunDate != '') {
    lastRunDate = new Date(env.lastRunDate);
  }

  var retrieveRequests = [];
  var numItems = 0;
  var numItemsTotal = 0;
  var numChangedItems = 0;
  var numChangedItemsTotal = 0;
  var dictionary = {};
  for (var x=0; x < results.length; x++) {
    var metaList = results[x];
    for (var y=0; y < metaList.length; y++) {
      var meta = metaList[y];
      var lastModifiedDate = new Date(meta.lastModifiedDate)

      //don't pull down anything in managed packages
      if (meta.manageableState === 'installed') {
        continue;
      }

      numItemsTotal++;
      if (lastModifiedDate > lastRunDate || env.retrieveAll) {
        if (numChangedItems == env.retrieveLimitPerRequest && !isProfiles) {
          retrieveRequests.push(dictionary);
          dictionary = {};
          numChangedItems = 0;
        }

        numChangedItems++;
        numChangedItemsTotal++;
        if (typeof dictionary[meta.type] === 'undefined') {
          dictionary[meta.type]  = [];
        }
        dictionary[meta.type].push(meta);
      }
    }
  }
  retrieveRequests.push(dictionary);
  
  console.log('expecting %s of %s items in %s request(s)', numChangedItemsTotal, numItemsTotal, retrieveRequests.length);

  retrieveFinished = callback;
  for (var x=0; x < retrieveRequests.length; x++) {
    var retrieveRequest = retrieveRequests[x];
    var types = [];
    for (var key in retrieveRequest) {
      types.push(createMetaListType(key, retrieveRequest[key]));
    }
    retrieveCalls++;
    retrieveMetadata(types, retrieveCallback);
  }
}

function getFolderRequest(metaType, folders) {
  var reportFolders = [];
  for (var i=0; i < folders.length; i++) {
    var meta = folders[i];
    var folder = {
      type : metaType,
      folder : meta.fullName
    };
    reportFolders.push(folder);
  }
  return reportFolders;
}
/*
function buildPackage(results) { 
  console.log('finish metalists');

  var customObjects = results[0];
  var dashboard = results[1];
  var emailTemplate = results[2];
  var report = results[3];
  var workflow = results[4];
  
  var types = [];
  
  for (var i=0; i < metaTypes.length; i++) {
    types.push(createWildcardType(metaTypes[i]));
  }
  
  //CustomObject (wildcard would only pull custom objects and not custom fields etc on standard ones)
  if (Array.isArray(customObjects)) { types.push(createMetaListType('CustomObject', customObjects)); }
  //Dashboard (has folders, no wildcard support)
  if (Array.isArray(dashboard)) { types.push(createMetaListType('Dashboard', dashboard)); }
  //EmailTemplate (has folders, no wildcard support)
  if (Array.isArray(emailTemplate)) { types.push(createMetaListType('EmailTemplate', emailTemplate)); }
  //Report (has folders, no wildcard support)
  if (Array.isArray(report)) { types.push(createMetaListType('Report', report)); }
  //Workflow (wildcard would pull extra unrelated workflows like Work... prefixed WorkCoaching)
  if (Array.isArray(workflow)) { types.push(createMetaListType('Workflow', workflow)); }

  retrieveMetadata(types);
}

function createWildcardType(metaType) {
  var pkgType = {
    members : '*',
    name : metaType
  };
  return pkgType;
}
*/

function createMetaListType(metaType, metaItems) {
  var pkgType = {
    members : [],
    name : metaType
  };

  for (var i=0; i < metaItems.length; i++) {
    var meta = metaItems[i];
    pkgType.members.push(meta.fullName);
  }
  return pkgType;
}

function retrieveMetadata(types, callback) {
  var retrievePackage = { types : types };
  var retrieveRequest = { apiVersion : 36.0, unpackaged : retrievePackage };

  //using guid so multiple retrieves can come back at the same time with unique file name
  var id = uuid.v4();
  var zipFile = '/' + id + '.zip';
  var stream = conn.metadata.retrieve(retrieveRequest).stream();
  var r = stream.pipe(fs.createWriteStream(env.svnPath + zipFile));

  r.on('finish', function () { 
    var zip = new decompress({ mode: 755 }).src(env.svnPath + zipFile).dest(env.svnPath + tempFolder).use(decompress.zip({ strip: 1 }));
    
    zip.run(function (err) {
      if (err) { return console.error(err); }
      fs.removeSync(env.svnPath + zipFile);
      callback(null);
    });
  });
}

function svnCommit(callback) {
  if (env.svnCommit && !env.keepTempFiles) {
    var connSvn = new svnClient({
        cwd: env.svnPath,
        username: env.svnUsername,
        password: env.svnPassword,
    });

    connSvn.update(function(err1, data1) {
      connSvn.addLocal(function(err2, data2) {
        console.log('local changes added for commit');
        connSvn.commit('sforceCI daily commit', function(err, data) {
          console.log('local changes committed');
          callback(startedDate);
        });
      });
    });
  } else {
    console.log('svn disabled');
    callback(null);
  }
}

//callback handlers
function metaFolderCallback(callbacks, last) {
  var results = [];
  var result_count = 0;
  callbacks.forEach(function(callback, index) {
    callback(function(err, metadata) {
      results[index] = metadata;
      result_count++;
      if (err) { console.log(err); }
      console.log('metaFolderCallback processed %s', index);
      if(result_count == callbacks.length) {
        last(results);
      }
    });
  });
}

var metaListCalls = 0;
var metaListReturned = 0;
var metaListResults = [];
var metaListFinished = null;
function metaListCallback(err, metadata) {
  if (err) { console.log(err); }
  if (typeof metadata === 'undefined') {
      //console.log('no meta for:', metaTypes[x]);
  } else {
    metaListResults.push(metadata);
  }
  metaListReturned++;
  console.log('metaListCallback processed %s of %s', metaListReturned, metaListCalls);

  if (metaListCalls == metaListReturned) {
    metaListFinished(metaListResults);
  }
}

var retrieveCalls = 0;
var retrieveReturned = 0;
var retrieveFinished = null;
function retrieveCallback(err) {
  if (err) { console.log(err); }
 
  retrieveReturned++;
  console.log('retrieveCallback processed %s of %s', retrieveReturned, retrieveCalls);

  if (retrieveCalls == retrieveReturned) {
    retrieveFinished(null);
  }
}

function resetCallbacks() {
  metaListCalls = 0;
  metaListReturned = 0;
  metaListResults = [];
  metaListFinished = null;
  retrieveCalls = 0;
  retrieveReturned = 0;
  retrieveFinished = null;
}

module.exports = {
  process: function (args, callback) {
    process(args, callback);
  },
  bar: function () {
    // whatever
  }
};