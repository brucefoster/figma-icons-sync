const { extractIds, _defaultSVGoSettings } = require('./utils');
const FigmaSync = require('./sync');

const sync = async (figmaLink, config, forceReload = false) => {
    if(typeof config !== 'object') {
        throw new Error('Config should be an object');
    }

    const conf = (key, strict = true, fallback = false) => {
        if(strict === true && key in config === false) {
            throw new Error(`Required key '${key}' is not present in the config`);
        }

        const keys = key.split('.');
        const value = keys.reduce((acc, k) => {
            return acc !== -Infinity && k in acc ? acc[k] : -Infinity; 
        }, config);

        return value !== -Infinity && (strict || typeof value === typeof fallback) ? value : fallback; 
        
    };

    const { fileId, nodeId } = extractIds(figmaLink);

    const options = {
        token: conf('apiToken'),
        outputDirectory: conf('output', false, './icons/'),

        fileId: fileId,
        nodeId: nodeId,

        monochrome: {
            colors: conf('monochrome.colors', false, ['black', '000000']),
            removeFill: conf('monochrome.removeFill', false, false),
            removeStroke: conf('monochrome.removeStroke', false, false),
        },

        cli: {
            enabled: false,
        },

        svgoConfig: conf('svgoConfig', false, _defaultSVGoSettings)
    };

    const syncer = new FigmaSync(options);

    return new Promise(async (resolve, reject) => {
        let changes;

        try {
            await syncer.revalidateLocalChanges();
            changes = await syncer.extractIcons(forceReload);
        } catch(err) {
            reject(err);
        }

        resolve(changes);
    });
}

exports.sync = sync;