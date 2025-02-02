## Sync Your Local Icons with Figma
A Node.js tool to keep your local icons in sync with your design team's Figma files and optimize them using [SVGo](https://github.com/svg/svgo/tree/main).

CLI mode is also available.

## Installation
Install it via npm:
```
npm install -g figma-icons-sync
```

## How It Works
Every time you run the tool:
1. it scans the Figma frame that contains the icons,
2. checks if anything has changed compared to the local versions,
3. fetches the updates and optimizes them using SVGo with your settings.

No special frame structure required — feel free to use Auto Layout, nested frames, groups, descriptions and memes. Just make sure the icons are components (individual components or component sets).

The tool will notify you if:
- a remote icon's name changes,
- a new icon name conflicts with an existing one in your local files.

## Prerequisites
You’ll need a [Figma personal access token](https://www.figma.com/developers/api#access-tokens) for a user who has access to the icons.  
For Professional or higher plans, you can add a dummy read-only user to the project and generate a token for them.

## API Usage
To use the module, import it in your project:  
```javascript
import { sync } from 'figma-icons-sync';
```

Or if you're using `require`:  
```javascript
const { sync } = require('figma-icons-sync');
```

Then call `sync`, passing in the URL of the Figma frame with the icons:
```javascript
const options = {
    apiToken: '%Insert your token here%',
};

// Copy the frame link from Figma (Right-click → Copy Link) and pass it as the first argument:
sync(
    'https://www.figma.com/file/71UBnODS8DUi06bjMlCH/UI-Kit?type=design&node-id=4909-11807', 
    options
)
.catch(error => console.log(error))
.then(response => { 
    console.log(response);
});
```

To force a re-fetch of all icons, pass `true` as the third argument:
*Note: This will overwrite any local files if there's a remote icon with the same name.*
```javascript
sync(
    'https://www.figma.com/file/71UBnODS8DUi06bjMlCH/UI-Kit?type=design&node-id=4909-11807', 
    options,
    true
)
.catch(error => console.log(error))
.then(response => { 
    console.log(response);
});
```

You can also customize the options for your needs:
```javascript
const options = {
    // Figma token, required to work
    apiToken: '%Insert your token here%', 

    // Folder to save icons, default: ./icons/
    output: './icons/',

    // Ignore subfolders in icon names. When set to true, an icon like «socials/facebook» 
    // will be renamed to «socials_facebook» instead of being placed in a «socials» subfolder. 
    // Default: false
    ignoreSubfolders: true,

    // Show output in the console as in CLI mode (default: false)
    enableConsoleOutput: true,

    // Settings for removing fill and stroke in monochrome icons
    monochrome: {
        // Icons will be considered monochrome if filled with one of the matching colors (remove leading #).
        // Default: ['black', '000000']
        colors: ['FFFFFF'],

        // Remove the fill color attribute
        removeFill: true,

        // Remove the stroke color attribute
        removeStroke: true,
    },

    // SVGo configuration. See documentation here:
    // https://github.com/svg/svgo/tree/main#configuration
    svgoConfig: {
        multipass: true,  // Run optimization multiple times
    }
};
```

## CLI Usage
Run the tool from the command line with default settings:  
```bash
icons-sync -t FIGMA_TOKEN "https://www.figma.com/file/..."
```

To specify a custom output folder (default is `./icons/`):  
```bash
icons-sync -t FIGMA_TOKEN -o "./public/icons/" "https://www.figma.com/file/..."
```

To use a custom SVGo config:  
```bash
icons-sync -t FIGMA_TOKEN --svgo-conf "svgoconfig.json" "https://www.figma.com/file/..."
```

For more options and advanced usage:  
```bash
icons-sync --help
```

## Contribution & Support
Found a bug or have an idea? [Open an issue](https://github.com/brucefoster/figma-icons-sync/issues/new) or feel free to submit a PR!