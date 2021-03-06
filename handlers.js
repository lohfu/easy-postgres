'use strict'

const _ = require('lodash')

const { one, many } = require('./result')
const sql = require('./sql-helpers')

const factories = {
  count ({ db, table }) {
    return function count (json, client = db) {
      let query = `SELECT count(id) FROM ${table}`

      let values

      if (Object.keys(json).length) {
        query += ` WHERE ${sql.where(json)}`
        values = Object.values(_.omitBy(json, _.isNil))
      }

      query += ';'

      return client.query(query, values).then((result) => parseInt(result.rows[0].count, 10))
    }
  },

  create ({ db, table, columns, emitter, mapKeys }) {
    const columnsString = sql.columns(columns)

    return function create (json, client = db) {
      json = _.pickBy(json, (value, key) => !_.isUndefined(value) && columns.includes(key))

      let keys = Object.keys(json)

      if (mapKeys) {
        keys = keys.map(mapKeys)
      }

      const values = Object.values(json)

      const query = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${values.map((v, i) => `$${i + 1}`).join(', ')}) RETURNING ${columnsString};`

      return client.query(query, values).then((result) => {
        const item = result.rows[0]

        if (emitter) emitter.emit('db', { table, action: 'create', item })

        return item
      })
    }
  },

  createMany ({ db, table, columns, emitter, mapKeys }) {
    const columnsString = sql.columns(columns)

    return function createMany (collection, client = db) {
      if (!Array.isArray(collection)) {
        collection = [collection]
      }

      let keys = []

      const values = collection.map((item) => {
        const arr = []

        for (const key in item) {
          if (columns.includes(key)) {
            let index = keys.indexOf(key)

            if (index < 0) {
              keys.push(key)
              index = keys.length - 1
            }

            arr[index] = item[key] === null ? 'NULL' : item[key]
          }
        }

        return arr
      }).map((arr) => arr.map((value) => value !== undefined ? value : 'DEFAULT'))

      if (mapKeys) {
        keys = keys.map(mapKeys)
      }

      const str = values.map((arr) => arr.join(', ')).join('), (')

      const query = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${str}) RETURNING ${columnsString};`

      return client.query(query, values).then((result) => {
        if (emitter) emitter.emit('db', { table, action: 'create', item: result.rows })

        return result.rows
      })
    }
  },

  find ({ db, table, columns, emitter, defaults = {} }) {
    const columnsString = sql.columns(columns)

    return function find (json, client = db) {
      const {
        offset = defaults.offset,
        limit = defaults.limit,
        sort = defaults.sort,
      } = json

      json = _.omit(json, 'limit', 'sort', 'offset')

      let q = `SELECT ${columnsString} FROM ${table}`

      if (Object.keys(json).length) {
        q += ` WHERE ${sql.where(json)}`
      }

      if (sort) {
        q += ` ORDER BY ${sort}`
      } else {
        q += ' ORDER BY id DESC'
      }

      if (limit) {
        q += ` LIMIT ${limit} OFFSET ${offset}`
      }

      q += ';'

      const values = Object.values(_.omitBy(json, _.isNil))

      return client.query(q, values).then(many)
    }
  },

  findById ({ db, table, columns }) {
    columns = sql.columns(columns)

    const query = `SELECT ${columns} FROM ${table} WHERE id = $1;`

    return function findById (id, client = db) {
      return client.query(query, [ id ]).then(one)
    }
  },

  findOne ({ db, table, columns }) {
    columns = sql.columns(columns)

    return function findOne (json, client = db) {
      let query = `SELECT ${columns} FROM ${table}`

      let values

      if (!_.isEmpty(json)) {
        query += ` WHERE ${sql.where(json)}`
        values = Object.values(_.omitBy(json, _.isNil))
      }

      query += ' LIMIT 1;'

      return client.query(query, values).then(one)
    }
  },

  getAll ({ db, table, columns }) {
    columns = sql.columns(columns)

    const query = `SELECT ${columns} FROM ${table} ORDER BY id DESC;`

    return function getAll (client = db) {
      return client.query(query).then(many)
    }
  },

  remove ({ db, table, columns, emitter }) {
    const query = `DELETE FROM ${table} WHERE id = $1;`

    return function remove (id, client = db) {
      return client.query(query, [id]).then((result) => {
        if (emitter) emitter.emit('db', { table, action: 'delete', item: result.rows[0] })

        return result.rowCount
      })
    }
  },

  // should be used with PUT
  replace ({ db, table, columns, emitter, mapKeys }) {
    const columnsString = sql.columns(columns)

    const empty = columns.reduce((obj, key) => {
      obj[key] = null

      return obj
    }, {})

    return function replace (id, json, client = db) {
      json = _.defaults(_.pick(json, columns), empty)

      let keys = Object.keys(json)

      if (mapKeys) {
        keys = keys.map(mapKeys)
      }

      const values = Object.values(json)

      const query = `UPDATE ${table} SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING ${columnsString};`

      return client.query(query, [...values, id]).then((result) => {
        if (emitter) emitter.emit('db', {table, action: 'update', item: result.rows[0]})

        return result.rows[0]
      })
    }
  },

  // should be used with PATCH
  update ({ db, table, columns, emitter, mapKeys }) {
    const columnsString = sql.columns(columns)

    return function update (id, json, client = db) {
      json = _.pick(json, columns)

      let keys = Object.keys(json)

      if (mapKeys) {
        keys = keys.map(mapKeys)
      }

      const values = Object.values(json)

      const query = `UPDATE ${table} SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(', ')} WHERE id = $${keys.length + 1} RETURNING ${columnsString};`

      return client.query(query, [...values, id]).then((result) => {
        if (emitter) emitter.emit('db', {table, action: 'update', item: result.rows[0]})

        return result.rows[0]
      })
    }
  },
}

const all = Object.keys(factories)

module.exports = ({ db, emitter, table, columns, exclude, include, camelCase = true, mapKeys }) => {
  // if (db instanceof pg.Pool || _.isPlainObject(db)) db = dbFactory(db);

  if (camelCase && !mapKeys) {
    mapKeys = (key) => `"${_.snakeCase(key)}"`
  }

  include = include || _.difference(all, exclude)

  return include.reduce((result, value) => {
    if (factories[value]) {
      result[value] = factories[value]({ mapKeys, columns, db, emitter, table })
    }

    return result
  }, {})
}

Object.assign(module.exports, factories)
