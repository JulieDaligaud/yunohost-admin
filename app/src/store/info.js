import Vue from 'vue'
import router from '@/router'
import i18n from '@/i18n'
import api from '@/api'
import { timeout, isObjectLiteral } from '@/helpers/commons'

export default {
  state: {
    host: window.location.host, // String
    connected: localStorage.getItem('connected') === 'true', // Boolean
    yunohost: null, // Object { version, repo }
    waiting: false, // Boolean
    reconnecting: null, // null|Object { attemps, delay, initialDelay }
    history: [], // Array of `request`
    requests: [], // Array of `request`
    error: null, // null || request
    historyTimer: null, // null || setTimeout id
    tempMessages: [] // array of messages
  },

  mutations: {
    'SET_CONNECTED' (state, boolean) {
      localStorage.setItem('connected', boolean)
      state.connected = boolean
    },

    'SET_YUNOHOST_INFOS' (state, yunohost) {
      state.yunohost = yunohost
    },

    'SET_WAITING' (state, boolean) {
      state.waiting = boolean
    },

    'SET_RECONNECTING' (state, args) {
      state.reconnecting = args
    },

    'ADD_REQUEST' (state, request) {
      if (state.requests.length > 10) {
        // We do not remove requests right after it resolves since an error might bring
        // one back to life but we can safely remove some here.
        state.requests.shift()
      }
      state.requests.push(request)
    },

    'UPDATE_REQUEST' (state, { request, key, value }) {
      // This rely on data persistance and reactivity.
      Vue.set(request, key, value)
    },

    'REMOVE_REQUEST' (state, request) {
      const index = state.requests.lastIndexOf(request)
      state.requests.splice(index, 1)
    },

    'ADD_HISTORY_ACTION' (state, request) {
      state.history.push(request)
    },

    'ADD_TEMP_MESSAGE' (state, { request, message, type }) {
      state.tempMessages.push([message, type])
    },

    'UPDATE_DISPLAYED_MESSAGES' (state, { request }) {
      if (!state.tempMessages.length) {
        state.historyTimer = null
        return
      }

      const { messages, warnings, errors } = state.tempMessages.reduce((acc, [message, type]) => {
        acc.messages.push(message)
        if (['error', 'warning'].includes(type)) acc[type + 's']++
        return acc
      }, { messages: [], warnings: 0, errors: 0 })
      state.tempMessages = []
      state.historyTimer = null
      request.messages = request.messages.concat(messages)
      request.warnings += warnings
      request.errors += errors
    },

    'SET_ERROR' (state, request) {
      if (request) {
        state.error = request
      } else {
        state.error = null
      }
    }
  },

  actions: {
    'CHECK_INSTALL' ({ dispatch }, retry = 2) {
      // this action will try to query the `/installed` route 3 times every 5 s with
      // a timeout of the same delay.
      // FIXME need testing with api not responding
      return timeout(api.get('installed'), 5000).then(({ installed }) => {
        return installed
      }).catch(err => {
        if (retry > 0) {
          return dispatch('CHECK_INSTALL', --retry)
        }
        throw err
      })
    },

    'CONNECT' ({ commit, dispatch }) {
      commit('SET_CONNECTED', true)
      dispatch('GET_YUNOHOST_INFOS')
    },

    'RESET_CONNECTED' ({ commit }) {
      commit('SET_CONNECTED', false)
      commit('SET_YUNOHOST_INFOS', null)
    },

    'DISCONNECT' ({ dispatch }, route = router.currentRoute) {
      dispatch('RESET_CONNECTED')
      if (router.currentRoute.name === 'login') return
      router.push({
        name: 'login',
        // Add a redirect query if next route is not unknown (like `logout`) or `login`
        query: route && !['login', null].includes(route.name)
          ? { redirect: route.path }
          : {}
      })
    },

    'LOGIN' ({ dispatch }, password) {
      return api.post('login', { credentials: password }, null, { websocket: false }).then(() => {
        dispatch('CONNECT')
      })
    },

    'LOGOUT' ({ dispatch }) {
      dispatch('DISCONNECT')
      return api.get('logout')
    },

    'TRY_TO_RECONNECT' ({ commit, dispatch }, args = {}) {
      // FIXME This is very ugly arguments forwarding, will use proper component way of doing this when switching to Vue 3 (teleport)
      commit('SET_RECONNECTING', args)
      dispatch('RESET_CONNECTED')
    },

    'GET_YUNOHOST_INFOS' ({ commit }) {
      return api.get('versions').then(versions => {
        commit('SET_YUNOHOST_INFOS', versions.yunohost)
      })
    },

    'INIT_REQUEST' ({ commit }, { method, uri, humanKey, initial, wait, websocket }) {
      // Try to find a description for an API route to display in history and modals
      const { key, ...args } = isObjectLiteral(humanKey) ? humanKey : { key: humanKey }
      const humanRoute = key ? i18n.t('human_routes.' + key, args) : `[${method}] /${uri}`

      let request = { method, uri, humanRouteKey: key, humanRoute, initial, status: 'pending' }
      if (websocket) {
        request = { ...request, messages: [], date: Date.now(), warnings: 0, errors: 0 }
        commit('ADD_HISTORY_ACTION', request)
      }
      commit('ADD_REQUEST', request)
      if (wait) {
        setTimeout(() => {
          // Display the waiting modal only if the request takes some time.
          if (request.status === 'pending') {
            commit('SET_WAITING', true)
          }
        }, 400)
      }

      return request
    },

    'END_REQUEST' ({ state, commit }, { request, success, wait }) {
      // Update last messages before finishing this request
      clearTimeout(state.historyTimer)
      commit('UPDATE_DISPLAYED_MESSAGES', { request })

      let status = success ? 'success' : 'error'
      if (success && (request.warnings || request.errors)) {
        const messages = request.messages
        if (messages.length && messages[messages.length - 1].color === 'warning') {
          request.showWarningMessage = true
        }
        status = 'warning'
      }

      commit('UPDATE_REQUEST', { request, key: 'status', value: status })
      if (wait && !request.showWarningMessage) {
        // Remove the overlay after a short delay to allow an error to display withtout flickering.
        setTimeout(() => {
          commit('SET_WAITING', false)
        }, 100)
      }
    },

    'DISPATCH_MESSAGE' ({ state, commit, dispatch }, { request, messages }) {
      for (const type in messages) {
        const message = {
          text: messages[type].replaceAll('\n', '<br>'),
          color: type === 'error' ? 'danger' : type
        }
        let progressBar = message.text.match(/^\[#*\+*\.*\] > /)
        if (progressBar) {
          progressBar = progressBar[0]
          message.text = message.text.replace(progressBar, '')
          const progress = { '#': 0, '+': 0, '.': 0 }
          for (const char of progressBar) {
            if (char in progress) progress[char] += 1
          }
          commit('UPDATE_REQUEST', { request, key: 'progress', value: Object.values(progress) })
        }
        if (message.text) {
          // To avoid rendering lag issues, limit the flow of websocket messages to batches of 50ms.
          if (state.historyTimer === null) {
            state.historyTimer = setTimeout(() => {
              commit('UPDATE_DISPLAYED_MESSAGES', { request })
            }, 50)
          }
          commit('ADD_TEMP_MESSAGE', { request, message, type })
        }
      }
    },

    'HANDLE_ERROR' ({ commit, dispatch }, error) {
      if (error.code === 401) {
        // Unauthorized
        dispatch('DISCONNECT')
      } else if (error.logRef) {
        // Errors that have produced logs
        router.push({ name: 'tool-log', params: { name: error.logRef } })
      } else {
        // The request is temporarely stored in the error for reference, but we reverse
        // the ownership to stay generic.
        const request = error.request
        delete error.request
        Vue.set(request, 'error', error)
        // Display the error in a modal on the current view.
        commit('SET_ERROR', request)
      }
    },

    'REVIEW_ERROR' ({ commit }, request) {
      request.review = true
      commit('SET_ERROR', request)
    },

    'DISMISS_ERROR' ({ commit, state }, { initial, review = false }) {
      if (initial && !review) {
        // In case of an initial request (data that is needed by a view to render itself),
        // try to go back so the user doesn't get stuck at a never ending skeleton view.
        if (history.length > 2) {
          history.back()
        } else {
          // if the url was opened in a new tab, return to home
          router.push({ name: 'home' })
        }
      }
      commit('SET_ERROR', null)
    },

    'DISMISS_WARNING' ({ commit, state }, request) {
      commit('SET_WAITING', false)
      Vue.delete(request, 'showWarningMessage')
    }
  },

  getters: {
    host: state => state.host,
    connected: state => state.connected,
    yunohost: state => state.yunohost,
    error: state => state.error,
    waiting: state => state.waiting,
    reconnecting: state => state.reconnecting,
    history: state => state.history,
    lastAction: state => state.history[state.history.length - 1],
    currentRequest: state => {
      const request = state.requests.find(({ status }) => status === 'pending')
      return request || state.requests[state.requests.length - 1]
    }
  }
}
