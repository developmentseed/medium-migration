'use strict'

const Hapi = require('hapi')
const fetch = require('node-fetch')

const clientId = process.env.MEDIUM_CLIENT_ID
const clientSecret = process.env.MEDIUM_CLIENT_SECRET
const redirectUri = process.env.REDIRECT_URI

const server = Hapi.server({
  port: process.env.PORT || 4000
})

const init = async () => {
  await server.register(require('vision'))

  server.route({
    method: 'GET',
    path: '/',
    handler: (request, res) => {
      return res.view('index', {
        clientId: clientId,
        state: 'medium-token-getter',
        scope: 'basicProfile,publishPost,listPublications',
        redirectUri
      })
    }
  })

  server.route({
    method: 'GET',
    path: '/callback',
    handler: async (request, res) => {
      const { error, code } = request.query

      if (error) return res.view('callback', { error })
      if (!code) return res.view('callback', { error: 'No direct access' })

      const tokenRequest = await fetch(`https://api.medium.com/v1/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `code=${code}&client_id=${clientId}&client_secret=${clientSecret}&grant_type=authorization_code&redirect_uri=${redirectUri}`
      })

      const tokenData = await tokenRequest.json()

      if (tokenData.errors) return res.view('callback', { error: tokenData.errors.map(e => e.message).join('; ') })

      const data = {
        token: tokenData.access_token,
        expires: (new Date(tokenData.expires_at)).toDateString()
      }
      return res.view('callback', data)
    }
  })

  server.views({
    engines: {
      html: require('handlebars')
    },
    relativeTo: __dirname,
    path: 'templates'
  })

  await server.start()
  console.log(`Server running at: ${server.info.uri}`)
}

process.on('unhandledRejection', (err) => {
  console.log(err)
  process.exit(1)
})

init()
