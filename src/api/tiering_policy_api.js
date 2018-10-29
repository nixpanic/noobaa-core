/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 *
 * TIERING POLICY API
 *
 *
 */
module.exports = {

    id: 'tiering_policy_api',

    methods: {

        create_policy: {
            doc: 'Create Tiering Policy',
            method: 'POST',
            params: {
                $ref: '#/definitions/tiering_policy'
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        update_policy: {
            doc: 'Update Tiering Policy',
            method: 'POST',
            params: {
                $ref: '#/definitions/tiering_policy'
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        add_tier_to_policy: {
            doc: 'Adding Tier to Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name', 'tier'],
                properties: {
                    name: {
                        type: 'string'
                    },
                    tier: {
                        $ref: '#/definitions/tier_item'
                    }
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        read_policy: {
            doc: 'Read Tiering Policy',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tiering_name' },
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        get_policy_pools: {
            doc: 'Get Tiering Policy Pools',
            method: 'GET',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tiering_name' },
                }
            },
            reply: {
                $ref: '#/definitions/tiering_policy'
            },
            auth: {
                system: 'admin'
            }
        },

        delete_policy: {
            doc: 'Delete Tiering Policy',
            method: 'POST',
            params: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { $ref: 'common_api#/definitions/tiering_name' },
                }
            },
            auth: {
                system: 'admin'
            }
        }
    },

    definitions: {

        tiering_policy: {
            type: 'object',
            required: ['name', 'tiers'],
            properties: {
                name: { $ref: 'common_api#/definitions/tiering_name' },
                data: { $ref: 'common_api#/definitions/storage_info' },
                storage: { $ref: 'common_api#/definitions/storage_info' },
                chunk_split_config: { $ref: 'common_api#/definitions/chunk_split_config' },
                tiers: {
                    type: 'array',
                    items: {
                        $ref: '#/definitions/tier_item'
                    },
                }
            }
        },
        tier_item: {
            type: 'object',
            required: ['order', 'tier'],
            properties: {
                order: {
                    type: 'integer',
                },
                tier: { $ref: 'common_api#/definitions/tier_name' },
                spillover: {
                    type: 'boolean'
                },
                disabled: {
                    type: 'boolean'
                },
                mode: { $ref: '#/definitions/tier_placement_status' }
            },
        },
        tier_placement_status: {
            type: 'string',
            enum: [
                'NO_RESOURCES',
                'NOT_ENOUGH_RESOURCES',
                'NOT_ENOUGH_HEALTHY_RESOURCES',
                'NO_CAPACITY',
                'RISKY_TOLERANCE',
                'LOW_CAPACITY',
                'DATA_ACTIVITY',
                'OPTIMAL'
            ]
        },
    },
};
