require('dotenv').config()
const fs = require('fs')
const path = require('path')
const url = require('url')
const fetch = require('node-fetch')
const glob = require('glob')
const yamlFront = require('yaml-front-matter')
const AWS = require('aws-sdk')

const mdImgRegex = /!\[[^\]]*\]\(([^)]*)\)/gm
const htmlImgRegex = /<img(?:.*)src=(?:"([^"]*)"|'([^']*)')/gm
const fileDateNameRegex = /(20[0-9]{2}-[0-9]{1,2}-[0-9]{1,2})-(.*)\.[a-z]+$/
const s3BaseUrl = 'https://s3.amazonaws.com'
const mediumApiUrl = 'https://api.medium.com/v1'
const devseedUrl = 'https://developmentseed.org'

const {
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET,
  MEDIUM_TOKEN,
  MEDIUM_PUB_ID
} = process.env

if (!MEDIUM_TOKEN) {
  console.log('Missing Medium credentials.')
  process.exit(1)
}

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.log('Missing AWS credentials.')
  process.exit(1)
}

if (!AWS_S3_BUCKET) {
  console.log('Missing S3 bucket.')
  process.exit(1)
}

var s3 = new AWS.S3()

// NOTE: Fix the img url in post /blog/2009/oct/28/smallcore-manifesto-help-us-build-better-teddy-bear

/**
 * Promisify the putObject from the AWS SDK.
 *
 * @param {object} params Parameters for s3.putObject
 */
function putS3Object (params) {
  return new Promise((resolve, reject) => {
    s3.putObject(params, (err, data) => {
      if (err) return reject(err)
      return resolve(data)
    })
  })
}

/**
 * Get the user id from medium associated to the current token.
 *
 * @async
 * @returns {string} The user id.
 */
async function getMediumUserId () {
  const res = await fetch(`${mediumApiUrl}/me/`, {
    headers: { 'Authorization': `Bearer ${MEDIUM_TOKEN}` }
  })
  const content = await res.json()
  handleMediumErrors(content)
  return content.data.id
}

/**
 * Get the user id from medium associated to the current token.
 *
 * @async
 * @param {string} userId The user id for which to check the publications.
 * @param {string} pub Publication to get the id for. The user of userId
 *                      must have access to it
 *
 * @returns {string} The user id.
 */
async function getMediumPublicationId (userId, pub) {
  const res = await fetch(`${mediumApiUrl}/users/${userId}/publications`, {
    headers: { 'Authorization': `Bearer ${MEDIUM_TOKEN}` }
  })
  const content = await res.json()
  handleMediumErrors(content)
  return content.data.find(p => p.name === pub).id
}

/**
 * Returns all the matched of the first or second capturing groups.
 *
 * @param {strine} string The content to check.
 * @param {RegExp} regexp The regular expression to use.
 *
 * @returns {array} Matches.
 */
function getMatches (string, regexp) {
  let matches = []
  let m
  while ((m = regexp.exec(string)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches.
    if (m.index === regexp.lastIndex) regexp.lastIndex++
    // Depends on the capturing group.
    matches.push(m[1] || m[2])
  }
  return matches
}

/**
 * Extracts image urls from markdown and <img /> tags.
 *
 * @param {string} content The content from where to extract the image urls.
 *
 * @returns {array} Matches.
 */
function extractImageUrls (content) {
  return getMatches(content, mdImgRegex)
    .concat(getMatches(content, htmlImgRegex))
}

/**
 * Filters the provided images list leaving only the ones that need to be
 * uploaded, i.e. the local ones.
 *
 * @param {array} images The images as returned by extractImageUrls().
 *
 * @returns {array} Local images that have to be uploaded.
 */
function filterUploadableImages (images) {
  return images.filter(i => {
    const u = url.parse(i)
    return !u.hostname || u.hostname === 'developmentseed.org'
  })
}

/**
 * Gets the year, month and day from a date a zero pads it.
 *
 * @param {date} date The date.
 *
 * @returns {array} Array with the year, month and day, zero padded.
 */
function getDateParts (date) {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()

  return [
    y,
    m < 10 ? `0${m}` : m,
    d < 10 ? `0${d}` : d
  ]
}

/**
 * Return the date specified in the frontmatter if available. Otherwise gets
 * the date from the filename.
 *
 * @param {string} file The post path.
 * @param {object} post The post with the frontmatter.
 *
 * @returns {date} The date.
 */
function getPostDate (file, { date }) {
  // Check if there's a date in the frontmatter.
  if (date) {
    const contentDate = new Date(date)
    if (!isNaN(contentDate.getTime())) return contentDate
  }
  // If not use the file date.
  const pieces = file.match(fileDateNameRegex)
  return new Date(pieces[1])
}

/**
 * Return the post url specified in the frontmatter if available. Otherwise
 * computes it from the filename according to the pattern.
 *
 * @param {string} file The post path.
 * @param {object} post The post with the frontmatter.
 *
 * @returns {string} The original post url at developmentseed.org
 */
function getOriginalURL (file, post) {
  // Check if there's a permalink defined.
  if (post.permalink) {
    return url.resolve(devseedUrl, post.permalink)
  }
  // Resolve the permalink from the filename.
  // Follows the structure: /blog/:year/:month/:day/:title
  const postTitle = file.match(fileDateNameRegex)[2]
  const postDate = getDateParts(getPostDate(file, post))

  return `${devseedUrl}/blog/${postDate.join('/')}/${postTitle}`
}

/**
 * Extracts, uploads and replaces the url of all images in the post content.
 * Return the content updated.
 *
 * @async
 * @param {string} content The post content.
 *
 * @see uploadImage()
 *
 * @returns {string} The updated content.
 */
async function handlePostContentImages (content) {
  const imgsToUpload = filterUploadableImages(extractImageUrls(content))
  console.log('  Found', imgsToUpload.length, 'images to upload')
  let count = 1
  for (const img of imgsToUpload) {
    const newURL = await uploadImage(img)
    console.log(`  Image ${count++} of ${imgsToUpload.length} uploaded -`, img, '=>', newURL)
    // Replace url in content.
    content = content.replace(img, newURL)
  }
  return content
}

/**
 * Adds a By line to the beginning of the post if an author was specified
 * in the frontmatter.
 * Return the content updated.
 *
 * @param {object} post The post with the frontmatter.
 * @param {string} content The post content.
 *
 * @returns {string} The updated content.
 */
function handlePostAuthors (post, content) {
  if (post.author) {
    return `By: ${post.author}\n\n${content}`
  }
  return content
}

/**
 * Adds the post card image as the first element in the post content.
 * Return the content updated.
 *
 * @param {object} post The post with the frontmatter.
 * @param {string} content The post content.
 *
 * @returns {string} The updated content.
 */
function moveCardImageToContent (post, content) {
  if (post.media && post.media.card && post.media.card.url) {
    return `![](${post.media.card.url})\n\n${content}`
  }
  return content
}

/**
 * Removes the liquid classes from the post content.
 * The liquid way to add classes is {: .classname } and is used for dropcap,
 * and footnotes
 * Return the content updated.
 *
 * @param {string} content The post content.
 *
 * @returns {string} The updated content.
 */
function handleLiquidClasses (content) {
  return content.replace(/{: .[a-z0-9-_]+ ?}/gm, '')
}

/**
 * Replace liquid codeblocks with backticks.
 * Return the content updated.
 *
 * @param {string} content The post content.
 *
 * @returns {string} The updated content.
 */
function handleCodeBlocks (content) {
  return content
    .replace(/{% ?highlight ?.* ?%}/gm, '```')
    .replace(/{% ?endhighlight ?%}/gm, '```')
}

/**
 * Removes excess of line breaks from the content
 * Return the content updated.
 *
 * @param {string} content The post content.
 *
 * @returns {string} The updated content.
 */
function handleLineBreaks (content) {
  return content.replace(/[\n]{3,}/gm, '\n\n')
}

/**
 * Removes {{ site.baseurl }} from the content
 * Return the content updated.
 *
 * @param {string} content The post content.
 *
 * @returns {string} The updated content.
 */
function handleSiteUrl (content) {
  return content.replace(/{{ ?site.baseurl ?}}/gm, '')
}

/**
 * Uploads the given image to Medium.
 *
 * @async
 * @param {string} img Path to image.
 *
 * @returns {string} Url of the image after upload.
 */
async function uploadImage (img) {
  img = img.replace(/^https?:\/\/developmentseed.org/, '')
  // return `${new Date()}.jpg`
  const imgKey = `images/${path.basename(img)}`

  if (process.argv[2] === '--dryrun') {
    return `http://localhost/test/${imgKey}`
  }

  await putS3Object({
    Body: fs.readFileSync(path.join(__dirname, 'posts_images', img)),
    Bucket: AWS_S3_BUCKET,
    Key: imgKey
  })

  // return new url.
  return `${s3BaseUrl}/${AWS_S3_BUCKET}/${imgKey}`
}

/**
 * Uploads the given post to Medium.
 *
 * @async
 * @param {object} post Post to upload formatted according to Medium's API.
 *
 * @returns {object} Medium API response.
 */
async function uploadPost (post) {
  if (process.argv[2] === '--dryrun') {
    return {
      url: `http://localhost/post/${post.title.toLowerCase().replace(' ', '-')}`
    }
  }

  // Publish to medium.
  const res = await fetch(`${mediumApiUrl}/publications/${MEDIUM_PUB_ID}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MEDIUM_TOKEN}`
    },
    body: JSON.stringify(post)
  })
  const content = await res.json()
  handleMediumErrors(content)
  return content.data
}

/**
 * Logs any errors that medium's api may have returns and terminates.
 *
 * @param {object} response Response from medium's api
 */
function handleMediumErrors (response) {
  if (response.errors) {
    console.log('  Medium error occurred')
    response.errors.forEach(e => console.log('   ', e.message))
    process.exit(1)
  }
}

/**
 * Get the paths of the post files that were not processed yet.
 * Uses 'upload-complete.csv' file as cache.
 *
 * @param {string} fileCompleted Name of the file with the completed posts
 *
 * @returns {array} Paths to files
 */
function getPostsFilesToProcess (fileCompleted) {
  if (process.argv[2] === '--dryrun' && process.argv[3]) {
    return glob.sync(process.argv[3])
  }

  let completed = []
  try {
    const done = fs.readFileSync(fileCompleted, 'utf8')
    completed = done.split('\n')
  } catch (e) {
    // Assume file doesn't exist.
  }
  // return glob.sync('posts/**/*.*').filter(f => completed.indexOf(f) === -1)
  return glob.sync('posts/blog-2018/*.*').filter(f => completed.indexOf(f) === -1).slice(0, 5)
}

//
//
// MAIN
//
async function main () {
  // In case we want to get the credentials
  if (process.argv[2] === '-p' && process.argv[3]) {
    const publicationId = await getMediumPublicationId(await getMediumUserId(), process.argv[3])
    console.log('Publication id:', publicationId)
    process.exit(0)
  }

  // If the script reaches this point, the medium pub id is needed.
  if (!MEDIUM_PUB_ID) {
    console.log('Missing Medium publication id')
    process.exit(1)
  }

  let fileRedirect = 'redirects.json'
  let fileCompleted = 'upload-complete.csv'
  // If we're doing a dryrun use other files.
  // Init the files with any previous completed.
  if (process.argv[2] === '--dryrun') {
    let fileRedirectContent = ''
    let fileCompletedContent = ''
    try {
      fileRedirectContent = fs.readFileSync(fileRedirect, 'utf8')
    } catch (error) { }
    try {
      fileCompletedContent = fs.readFileSync(fileCompleted, 'utf8')
    } catch (error) { }

    fileRedirect = 'dryrun-redirects.json'
    fileCompleted = 'dryrun-upload-complete.csv'

    fs.writeFileSync(fileRedirect, fileRedirectContent)
    fs.writeFileSync(fileCompleted, fileCompletedContent)
  }

  const files = getPostsFilesToProcess(fileCompleted)

  let idx = 1
  for (const file of files) {
    console.log(`Handling post ${idx++} of ${files.length}:`, file)
    const post = yamlFront.safeLoadFront(fs.readFileSync(file, 'utf8'))
    // Skip unpublished posts.
    if (typeof post.published !== 'undefined' && !post.published) {
      console.log('  Post in unpublished. Skipping')
      console.log('')
      continue
    }
    let content = post.__content
    // Move card image.
    content = moveCardImageToContent(post, content)
    // Remove {{site.baseurl}}.
    content = handleSiteUrl(content)
    // Add author name to the content.
    content = handlePostAuthors(post, content)
    // Remove dropcap.
    content = handleLiquidClasses(content)
    // Replace liquid codeblocks with backticks.
    content = handleCodeBlocks(content)
    // Remove extra line breaks.
    content = handleLineBreaks(content)
    // Upload images are replace urls in content.
    content = await handlePostContentImages(content)

    if (process.argv[2] === '--dryrun') {
      console.log('')
      console.log('  ---- Start Content ----')
      console.log(content)
      console.log('  ---- End Content ----')
      console.log('')
    }

    // Get original post url.
    const originalUrl = getOriginalURL(file, post)

    // Prepare data for Medium.
    const mediumPost = {
      title: post.title,
      contentFormat: 'markdown',
      publishedAt: getPostDate(file, post).toISOString(),
      content
    }

    const uploadResult = await uploadPost(mediumPost)
    fs.appendFileSync(fileRedirect, JSON.stringify({ from: originalUrl, to: uploadResult.url }) + '\n')
    fs.appendFileSync(fileCompleted, file + '\n')
    console.log('  Post uploaded.', originalUrl, '=>', uploadResult.url)
    console.log('')
  }

  // Dump the content pf the cache files and delete them.
  if (process.argv[2] === '--dryrun') {
    console.log('Redirects File')
    console.log(fs.readFileSync(fileRedirect, 'utf8'))
    console.log(' ')
    console.log('Completed File')
    console.log(fs.readFileSync(fileCompleted, 'utf8'))
    fs.unlinkSync(fileRedirect)
    fs.unlinkSync(fileCompleted)
  }
}

// Start
main()
