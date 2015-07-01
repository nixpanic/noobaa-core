'use strict';

/**
 *
 * CLUSTER API
 *
 * Cluster & HA
 *
 */
module.exports = {

    name: 'cluster_api',

    methods: {

        get_cluster_id: {
            doc: 'Read cluster id',
            method: 'GET',

            reply: {
                type: 'object',
                required: ['cluster_id'],
                properties: {
                    cluster_id: {
                        type: 'string'
                    }
                }
            },
            auth: {
                system: 'admin'
            }
        },

    },
};
