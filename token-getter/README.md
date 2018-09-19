# Medium Token Getter

Small utility to allow a user to get a token from medium for the migrator app.

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
Since medium doesn't allow to create applications on localhost the token-getter must be deployed somewhere.
A suggestion is to use Heroku. Create a medium application and update the env variables:
```
MEDIUM_CLIENT_ID
MEDIUM_CLIENT_SECRET
REDIRECT_URI
```
