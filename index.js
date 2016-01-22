#!/usr/bin/env node

var fuse = require('fuse-bindings')
var simple = require('simplerdf')
var request = require('request')
var basename = require('path').basename
var dirname = require('path').dirname
var ENOENT = -2
var EPERM = -1
var container = {
  'contains': {
    '@id': 'http://www.w3.org/ns/ldp#contains',
    '@array': true,
    '@type': '@id'
  },
  'mtime': 'http://www.w3.org/ns/posix/stat#mtime',
  'size': 'http://www.w3.org/ns/posix/stat#size'
}
var fs = {}
var fds = {}
var folders = {}

var src = notrailing(process.argv[2])
var mnt = process.argv[3]

if (!mnt || !src) {
  console.log('Usage: mount-solid [src] [mnt]')
  process.exit(1)
}

function hastrailing (path) {
  return path[path.length - 1] === '/'
}

function notrailing (path) {
  if (path[path.length - 1] === '/') path = path.slice(0, -1)
  return path
}

function getFile (path, cached, cb) {
  request.get(src + path)
}

function getFolder (path, cached, cb) {
  path = notrailing(path)
  if (cached && fs[path]) {
    var file = fs[path]
    return cb(typeof file === 'number' ? file : 0, file)
  }

  // console.log(src + path)
  simple(container, src + path + '/').get().then(function (g) {
    g.container = true
    fs[path] = g
    cb(0, g)
  }, function (err) {
    // console.log(err)
    if (typeof err === 'string') err = new Error(err)
    if (err.message.split(': ')[1] === '301') {
      return getFolder(path + '/', true, cb)
    }
    if (err.message.split(': ')[1] === '401' ||
        err.message.split(': ')[1] === '403') {
      fs[path] = EPERM
      return cb(fs[path])
    }
    cb(ENOENT)
  })
}

function getPathAttr (path) {
  var p = fs[notrailing(path)]
  if (!p || p.container !== true) {
    var parent = fs[notrailing(dirname(path))]
    if (!parent) {
      return ENOENT
    }
    p = parent.child(src + path)
    // console.log(p.mtime)
    if (!p.mtime) {
      p = fs[notrailing(dirname(path))].child(src + path + '/')
      p.container = true
    }
  }
  // console.log(path)
  return p
}

getFolder('/', true, function (err) {
  if (err) return console.log('Cannot connect to server')
  // console.log('starting on ' + src)
  fuse.mount(mnt, {
    options: ['direct_io'],
    force: true,
    displayFolder: true,
    readdir: function (path, cb) {
      // console.log('readdir(%s)', path)
      getFolder(path, true, function (err, g) {
        if (err) return cb(err)
        var contains = g.contains.map(function (url) {
          return basename(url)
        })
        // console.log(contains.join(', '))
        cb(0, contains)
      })
    },
    getattr: function (path, cb) {
      // console.log('getattr(%s)', path)
      var p = getPathAttr(path)

      if (typeof p === 'number') {
        cb(p)
      }

      var time = +p.mtime * 1000
      cb(0, {
        mtime: new Date(time),
        atime: new Date(time),
        ctime: new Date(time),
        size: +p.size,
        mode: p.container ? 16877 : 33206,
        uid: process.getuid(),
        gid: process.getgid()
      })
      // console.log(g.toString())
    },
    open: function (path, flags, cb) {
      var file = fs[notrailing(path)]
      if (!file) return cb(ENOENT)
      if (typeof file === 'number') return cb(file)
      var fd = Object.keys(fs).indexOf(notrailing(path))
      if (fd === -1) fd = fs.length

      fds[fd] = {offset: 0}

      // console.log('open()', path, fd)
      cb(0, fd)
    },
    read: function (path, fd, buf, len, pos, cb) {
      var str = 'hello world'.slice(pos, pos + len)
      if (!str) return cb(0)
      buf.write(str)
      return cb(str.length)
    }
  })
})

process.on('SIGINT', function () {
  fuse.unmount('./mnt', function () {
    process.exit()
  })
})
