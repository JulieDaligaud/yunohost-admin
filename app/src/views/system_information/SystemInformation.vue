<template>
  <view-base
    :queries="queries"
    @queries-response="onQueriesResponse"
    ref="view" skeleton="card-list-skeleton"
  >
    <div v-if="interfaces">
      <div :key="index" v-for="[interface_, ips], index in Object.entries(interfaces)">
        <p><b>Interface:</b> {{ interface_ }}</p>

        <div :key="index2" v-for="[ipv, options], index2 in Object.entries(ips)">
          <p><i>Ip version:</i> {{ ipv }}</p>

          <div :key="index3" v-for="option, index3 in options">
              <div :key="index4" v-for="[optionName, optionValue], index4 in Object.entries(option)">
                  <p><u>{{ optionName }}:</u> {{ optionValue }}</p>
              </div>
          </div>
        </div>
      </div>
    </div>
  </view-base>
</template>

<script>
import api from '@/api'

export default {
    name: 'SystemInformation',

    components: {
    },

    data () {
      return {
          queries: [
              ['GET', 'system-information/network/interfaces']
          ],
          interfaces: undefined
      }
    },

  methods: {
    onQueriesResponse (interfaces) {
        // debugger;
        console.log('pouet', interfaces)
        this.interfaces = interfaces
    }
}
}
</script>

<style lang="scss" scoped>
.main-interface-badge {
  font-size: .75rem;
  padding-right: .2em;
}
</style>
