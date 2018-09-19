# Medium Blog Migrator

This project was created to migrate the DSo blog to medium.

## Install Project Dependencies
To set up the development environment for this website, you'll need to install the following on your system:

- [Node](http://nodejs.org/) v8 (To manage multiple node versions we recommend [nvm](https://github.com/creationix/nvm))
- [Yarn](https://yarnpkg.com/) Package manager

### Install Application Dependencies

If you use [`nvm`](https://github.com/creationix/nvm), activate the desired Node version:

```
nvm install
```

Install Node modules:

```
yarn install
```

### Usage
This script's use case is very specific. It isn't meant to be abstract enough to fit all use cases, therefore some preparation is needed:
- The posts to be migrated must be inside a `posts` folder in the root of the project.
- The images used in the post must be placed inside a `posts_images` folder with all their nested folders.

The script will loop over every post, upload any image used on its content to the S3 bucket, replace the image url and upload the content to medium.

#### Env variables
Create a `.env` file with the following variables:
```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
MEDIUM_TOKEN
```

After these variables are set run:
```
node index.js -p "<Publication name>"
```
This will get the id of the medium publication under which the posts will be published.
Add the id to the `.env` file under `MEDIUM_PUB_ID`

#### Dry run
It is possible to make a dry run to test that everything is working:

```
node index.js --dryrun
```

#### Run
Run with:

```
node index.js
```

**Failsafe:**
Every time a post is successfully migrated it is added to the `upload-complete.csv` file. This file is loaded at the beginning and the posts already migrated are removed from the list. This is helpful if the process gets stopped midway.

**Redirects:**
Once a post migration is completed, a JSON object containing the old and new url is appended to `redirects.json` in the form of:
```
{"from":"<old url>","to":"<new url>"}
```
Note that this is not a valid json file. It has a JSON object per line.

*Both the `upload-complete.csv` and `redirects.json` are written to the root directory.*