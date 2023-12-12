## Sync your local icons with Figma
A NodeJS-based tool that keeps your local icons in sync with the icons from Figma files of your design team and optimizes them automatically with [SVGo](https://github.com/svg/svgo/tree/main).

CLI mode is available as well. 

## Installation
Via npm:
```
npm install -g figma-icons-sync
```

## How does this work
Upon every call, this tool: 
1. scans the frame containing icons in the Figma file,
2. determines changes with icons stored locally,
3. and fetches all the changes optimizing them via SVGo with your preferred config.

There are no special requirements to frame structure — feel free to use Auto Layout, nested frames, groups, add headings, descriptions and etc.
The only requirement is that the icons must be components (either components or component sets).

The tool will also alert you in the following situations: 
- when the name of a remote icon changes, 
- when a remote icon has the same name as your local icon.

## Prerequisites
Get a [Figma personal access token](https://www.figma.com/developers/api#access-tokens) on behalf of the user that can view files with icons.
On Professional and higher plans you can just add a dummy read-only user to the project and issue a token under their profile.

## API usage
Import the module and integrate it into the front-end developer's workflow using the ESM approach:
```javascript
import { sync } from 'figma-icons-sync';
```

Or connect it using CJS approach (with `require`):
```javascript
const { sync } = require('figma-icons-sync');
```

Then, call the `sync` method, passing the URL of the Figma frame that contains the icons:
```javascript
const options = {
    apiToken: '%Insert your token here%',
};

// Copy the link to the frame containing icons (Right-click on the frame in Figma → Copy link) and pass it as the first arg:
sync(
    'https://www.figma.com/file/71UBnODS8DUi06bjMlCH/UI-Kit?type=design&node-id=4909-11807', 
    options
)
.catch(error => console.log(error))
.then(response => { 
    console.log(response);
});
```

To force a re-fetch of all icons, pass `true` as the third argument to `sync`.
*Note. If there is a remote icon sharing the same name, force re-fetch will overwrite local files.*
```javascript
sync(
    'https://www.figma.com/file/71UBnODS8DUi06bjMlCH/UI-Kit?type=design&node-id=4909-11807', 
    options,
    true
)
.catch(error => console.log(error))
.then((response) => { 
    console.log(response);
});
```

Customize the options to suit your work processes:
```javascript
const options = {
    // Figma token, required
    apiToken: '%Insert your token here%',

    // Directory to upload icons to, default: ./icons/
    output: './icons/',

    // Ignore subfolders in icons' names: if set to true, an icon named «socials/facebook» will be placed in the «socials» subfolder
    // Default: false
    ignoreSubfolders: true,

    // Settings for monochromatic icons: enable removing fill="" and stroke="" attributes so you can control them with CSS
    monochrome: {
        // Array of colors (without #). An icon will be considered monochrome if it is filled only with one of these colors.
        // Default: ['black', '000000']
        colors: ['FFFFFF'],
        // Remove fill="color" from monochromatic icons
        removeFill: true,
        // Remove stroke="color" from monochromatic icons
        removeStroke: true
    },

    // SVGo configuration. See documentation here:
    // https://github.com/svg/svgo/tree/main#configuration
    svgoConfig: {
        multipass: true
    }
};
```

## CLI usage
With default settings:
```bash
icons-sync -t FIGMA_TOKEN "https://www.figma.com/file/..."
```
With custom output folder (default ./icons/):
```bash
icons-sync -t FIGMA_TOKEN -o "./public/icons/" "https://www.figma.com/file/..."
```
With custom SVGo config (passed as link to .json configuration):
```bash
icons-sync -t FIGMA_TOKEN --svgo-conf "svgoconfig.json" "https://www.figma.com/file/..."
```
Help for advanced usage:
```bash
icons-sync --help
```

## Contribution & Support
Feel free to make a PR or [to open an issue](https://github.com/brucefoster/figma-icons-sync/issues/new) if you're facing troubles.