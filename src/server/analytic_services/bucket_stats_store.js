/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

// const dbg = require('../../util/debug_module')(__filename);
const db_client = require('../../util/db_client');
const bucket_stats_schema = require('./bucket_stats_schema');

class BucketStatsStore {

    static instance(system) {
        BucketStatsStore._instance = BucketStatsStore._instance || new BucketStatsStore();
        return BucketStatsStore._instance;
    }

    constructor() {
        this._bucket_stats = db_client.instance().define_collection({
            name: 'bucketstats',
            schema: bucket_stats_schema,
            db_indexes: [{
                fields: {
                    bucket: 1
                }
            }],
        });
    }

    ////////////////////////
    // Bucket Stats funcs //
    ////////////////////////
    async update_bucket_counters({ system, bucket, write_count, read_count, content_type }) {
        const selector = { system, bucket, content_type };

        const update = {
            $set: _.omitBy({
                last_write: write_count ? Date.now() : undefined,
                last_read: read_count ? Date.now() : undefined,
                ...selector
            }, _.isUndefined),
            $inc: _.omitBy({
                writes: write_count,
                reads: read_count
            }, _.isUndefined)
        };

        const res = await this._bucket_stats.findOneAndUpdate(selector, update, {
            upsert: true,
            returnOriginal: false
        });

        this._bucket_stats.validate(res.value, 'warn');
    }

    get_all_buckets_stats({ system }) {
        return this._bucket_stats.aggregate([{
            $match: {
                system
            }
        }, {
            $group: {
                _id: '$bucket',
                stats: {
                    // TODO: Support in PostgreSQL aggregation
                    $push: {
                        content_type: '$content_type',
                        reads: '$reads',
                        writes: '$writes',
                        last_write: "$last_write",
                        last_read: "$last_read",
                    }
                },
                total_reads: { $sum: '$reads' },
                total_writes: { $sum: '$writes' },
                last_write: { $max: '$last_write' },
                last_read: { $max: '$last_read' },
            },
        }]);
    }

}

// EXPORTS
exports.BucketStatsStore = BucketStatsStore;
