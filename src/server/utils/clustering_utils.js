'use strict';

//While the appropriate place is under util/ since used by server and bg_workers
//Since its using the system_store, its located under server/utils

const _ = require('lodash');
const util = require('util');
const url = require('url');
const system_store = require('../system_services/system_store').get_instance();
const os_utils = require('../../util/os_utils');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const os = require('os');
const moment = require('moment');

function get_topology() {
    return system_store.get_local_cluster_info();
}

function update_cluster_info(params) {
    var current_clustering = system_store.get_local_cluster_info();
    var update = _.defaults(_.pick(params, _.keys(current_clustering)), current_clustering);
    update.owner_secret = system_store.get_server_secret(); //Keep original owner_secret
    update.owner_address = os_utils.get_local_ipv4_ips()[0];
    update._id = current_clustering._id;

    dbg.log0('Updating local cluster info for owner', update.owner_secret, 'previous cluster info',
        pretty_topology(current_clustering), 'new cluster info', pretty_topology(update));

    return system_store.make_changes({
            update: {
                clusters: [update]
            }
        })
        .then(() => {
            dbg.log0('local cluster info updates successfully');
            return;
        })
        .catch((err) => {
            console.error('failed on local cluster info update with', err.message);
            throw err;
        });
}


function update_host_address(address) {
    var current_clustering = system_store.get_local_cluster_info();
    //TODO:: publish changes to cluster!

    _.each(current_clustering.shards, function(shard, i) {
        var ind = _.findIndex(shard.servers, function(srv) {
            return srv.address === current_clustering.owner_address;
        });

        if (ind !== -1) {
            current_clustering.shards[i].servers[ind].address = url.parse(address).hostname;
        }
    });

    dbg.log0('clustering info after host update is', util.inspect(current_clustering, {
        depth: 6
    }));

    current_clustering.owner_address = url.parse(address).hostname;
    return system_store.make_changes({
            update: {
                clusters: [current_clustering]
            }
        })
        .catch((err) => {
            dbg.log0('Failed updating host address in clustering info');
            throw new Error('Failed updating host address in clustering info', err, err.stack);
        });
}

//Recieves array in the cluster info form ([{address:X},{address:y}]) and returns the array of IPs
function extract_servers_ip(arr) {
    return arr.map(srv => srv.address);
}

//Return all servers in the cluster, regardless of role
function get_all_cluster_members() {
    let servers = system_store.data.clusters.map(top => top.owner_address);
    return servers;
}

//Verifies given clusterId is equal to current, throws on mismatch
function verify_cluster_id(cluster_id) {
    if (get_topology().cluster_id !== cluster_id) {
        dbg.error('ClusterID mismatch: has', get_topology().cluster_id, ' recieved:', cluster_id);
        throw new Error('ClusterID mismatch');
    }
}

//Checks if current server is a stand-alone server
function is_single_server() {
    var top = get_topology();
    if (!top.config_servers.length &&
        top.shards.length === 1 &&
        top.shard[0].servers.length === 1) {
        return true;
    }
    return false;
}

function pretty_topology(topology) {
    return util.inspect(topology, {
        showHidden: false,
        depth: 10
    });
}

function rs_array_changes(new_array, name, is_config) {
    var current;
    if (is_config) {
        current = extract_servers_ip(get_topology().config_servers).sort();
    } else {
        var shard_idx = _.findIndex(get_topology().shards, function(s) {
            return name === s.shardname;
        });
        current = extract_servers_ip(get_topology().shards[shard_idx].servers);
    }
    var changes = Array.from(new_array).sort();

    if (current.length !== changes.length) {
        return true;
    }

    var changed = false;
    _.each(current, function(c_srv, i) {
        if (c_srv !== changes[i]) {
            changed = true;
        }
    });

    return changed;

}

function find_shard_index(shardname) {
    var shard_idx = _.findIndex(get_topology().shards, function(s) {
        return shardname === s.shardname;
    });

    return shard_idx;
}

function get_cluster_info() {
    let local_info = system_store.get_local_cluster_info();
    let shards = local_info.shards.map(shard => ({
        shardname: shard.shardname,
        servers: []
    }));
    _.each(system_store.data.clusters, cinfo => {
        let shard = shards.find(s => s.shardname === cinfo.owner_shardname);
        let memory_usage = 0;
        let cpu_usage = 0;
        let version = '0';
        let single_server = system_store.data.clusters.length === 1;
        let is_connected = single_server;
        let hostname = os.hostname();
        let time_epoch = moment().unix();
        let location = cinfo.location;
        if (cinfo.heartbeat) {
            memory_usage = (1 - cinfo.heartbeat.health.os_info.freemem / cinfo.heartbeat.health.os_info.totalmem);
            cpu_usage = cinfo.heartbeat.health.os_info.loadavg[0];
            version = cinfo.heartbeat.version;
            let now = Date.now();
            let diff = now - cinfo.heartbeat.time;
            is_connected = single_server || (diff < config.CLUSTER_NODE_MISSING_TIME);
            hostname = cinfo.heartbeat.health.os_info.hostname;
        }
        let server_info = {
            version: version,
            hostname: hostname,
            secret: cinfo.owner_secret,
            address: cinfo.owner_address,
            is_connected: is_connected,
            memory_usage: memory_usage,
            cpu_usage: cpu_usage,
            location: location,
            debug_level: cinfo.debug_level,
            ntp_server: cinfo.ntp && cinfo.ntp.server,
            timezone: cinfo.ntp && cinfo.ntp.timezone,
            dns_servers: cinfo.dns_servers || [],
            time_epoch: time_epoch
        };
        shard.servers.push(server_info);
    });
    _.each(shards, shard => {
        if (shard.servers.length < 3) {
            shard.high_availabilty = false;
        } else {
            let num_connected = shard.servers.filter(server => server.is_connected).length;
            // to be highly available the cluster must be able to stand a failure and still
            // have a majority to vote for a master.
            shard.high_availabilty = num_connected > (shard.servers.length + 1) / 2;
        }
    });
    let cluster_info = {
        master_secret: system_store.get_server_secret(),
        shards: shards
    };
    return cluster_info;
}

function get_potential_masters() {
    //TODO: For multiple shards, this should probably change?
    var masters = [];
    _.each(get_topology().shards[0].servers, function(s) {
        masters.push({
            address: s.address
        });
    });
    return masters;
}

function get_member_upgrade_status(ip) {
    dbg.log0('DZDZ:', 'get upgrade status for ip', ip);
    let server_entry = system_store.data.clusters.find(server => server.owner_address === ip);
    dbg.log0('DZDZ:', 'found server:', server_entry);
    if (!server_entry || !server_entry.upgrade) return 'NOT_READY';
    return server_entry.upgrade.status;
}


//Exports
exports.get_topology = get_topology;
exports.update_cluster_info = update_cluster_info;
exports.update_host_address = update_host_address;
exports.extract_servers_ip = extract_servers_ip;
exports.verify_cluster_id = verify_cluster_id;
exports.is_single_server = is_single_server;
exports.get_all_cluster_members = get_all_cluster_members;
exports.pretty_topology = pretty_topology;
exports.rs_array_changes = rs_array_changes;
exports.find_shard_index = find_shard_index;
exports.get_cluster_info = get_cluster_info;
exports.get_member_upgrade_status = get_member_upgrade_status;
exports.get_potential_masters = get_potential_masters;
