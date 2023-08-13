## Sync your local icons with Figma
A NodeJS-based tool that keeps your local icons in sync with the icons from Figma files of your design team and optimizes them automatically with [SVGo](https://github.com/svg/svgo/tree/main).

CLI mode is available as well. 

## Installation
Via npm:
```
npm -g install figma-icons-sync
```

## How does this work
Upon every call, this tool: 
1. scans the frame containing icons in the Figma file,
2. determines changes with icons stored locally,
3. and fetches all the changes optimizing them via SVGo with your preferred config.

There are no special requirements to frame structure — feel free to use Auto Layout, nested frames, groups, add headings, descriptions and etc.
The only requirement is that the icons must be components (either components or component sets).

## Prerequisites
Get a [Figma personal access token](https://www.figma.com/developers/api#access-tokens) on behalf of the user that can view files with icons.
On Professional and higher plans you can just add a dummy read-only user to the project and issue a token under their profile.

## API usage
Use the `sync` function as a part of the front-end developer's workflow:
```javascript
const { sync } = require('figma-icons-sync');

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

If you need to force re-fetch all the icons, pass `true` as the third argument to `sync`:
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

    // Settings for monochromatic icons: enable removing fill="" and stroke="" attributes so you can control them with CSS
    monochrome: {
        // Array of colors (without #). An icon will be considered monochrome if it filled only with one of these colors.
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