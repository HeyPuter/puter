/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const config = require("../config");

class Metric {
    constructor (windowSize) {
        this.count = 0;
        this.cumulative = 0;
        this.window = [];

        this.WINDOW_SIZE = windowSize;
    }

    pushValue (v) {
        this.window.push(v);
        this.cumulative += v;
        this.count++;
        this.update_();
    }

    update_ () {
        while ( this.window.length >= this.WINDOW_SIZE ) {
            this.window.shift();
        }

        this.windowAverage = this.window.reduce((sum, v) => sum + v)
            / this.window.length;
        this.cumulativeAverage = this.cumulative / this.count;
    }

    getCloudwatchMetrics (prefix) {
        const metrics = [];
        if ( this.count === 0 ) return [];

        const Timestamp = Math.floor(Date.now() / 1000);

        const Dimensions = [
            {
                Name: 'server-id',
                Value: config.server_id || 'unknown',
            },
            {
                Name: 'environment',
                Value: config.env || 'unknown',
            },
        ];

        if ( this.cumulativeAverage ) {
            metrics.push({
                MetricName: prefix + '.' + 'cumulative-avg',
                Value: this.cumulativeAverage,
                Timestamp,
                Unit: 'Milliseconds',
                Dimensions,
            });
        }

        if ( this.windowAverage && this.count >= this.WINDOW_SIZE ) {
            metrics.push({
                MetricName: prefix + '.' + 'window-avg',
                Value: this.windowAverage,
                Timestamp,
                Unit: 'Milliseconds',
                Dimensions,
            });
        }

        return metrics;
    }
}

class PerformanceMonitorContext {
    constructor ({ performanceMonitor, name }) {
        this.performanceMonitor = performanceMonitor;
        this.name = name;
        this.stamps = [];
        this.children = [];

        this.stamp('monitor-created');
    }

    branch () {}

    stamp (name) {
        if ( ! name ) {
            this.stamps[this.stamps.length - 1].end = Date.now();
            return;
        }
        this.stamps.push({
            name,
            ts: Date.now()
        });
    }

    label (name) {
        this.stamps.push({
            name,
            start: Date.now(),
        })
    }

    end () {
        this.stamp("end");
        this.performanceMonitor.logMonitorContext(this);
    }
}

module.exports = class PerformanceMonitor {
    static instance_ = null;

    constructor () {
        this.performanceMetrics = {};

        this.operationCounts = {};
        this.lastCountPollTS = Date.now();

        if ( config.cloudwatch ) {
            const AWS = require('aws-sdk');
            this.cw = new AWS.CloudWatch(config.cloudwatch);
        }


        if ( config.monitor ) {
            this.config = config.monitor;
        }
        if ( this.config.metricsInterval > 0 ) {
            setInterval(async () => {
                await this.recordMetrics_();
            }, this.config.metricsInterval);
        }
    }

    /*
        PerformanceMonitor was written before the services container
        existed, so we have to provide the services to it manually.
    */
    static provideServices (services) {
        this.services = services;
    }

    static getInstance () {
        if ( PerformanceMonitor.instance_ ) {
            return PerformanceMonitor.instance_;
        }

        return PerformanceMonitor.instance_ = new PerformanceMonitor();
    }

    static createContext (...a) {
        return this.getInstance().createContext(...a);
    }

    createContext (name) {
        return new PerformanceMonitorContext({
            performanceMonitor: this,
            name
        });
    }

    logMonitorContext (ctx) {
        if ( ! this.performanceMetrics.hasOwnProperty(ctx.name) ) {
            this.performanceMetrics[ctx.name] =
                new Metric(config.windowSize ?? 30);
        }
        
        const metricsToUpdate = {};

        // Update averaging metrics
        {
            const begin = ctx.stamps[0];
            for ( const stamp of ctx.stamps ) {
                let start = stamp.start ?? begin.ts;
                let end = stamp.end ?? stamp.ts;
                metricsToUpdate[stamp.name] =
                    (metricsToUpdate[stamp.name] ?? 0) +
                    (end - start);
            }

            for ( const name in metricsToUpdate ) {
                const value = metricsToUpdate[name];
                this.updateMetric_(`${ctx.name}.${name}`, value);
            }
        }

        // Update operation counts
        {
            if ( ! this.operationCounts[ctx.name] ) {
                this.operationCounts[ctx.name] = 0;
            }
            this.operationCounts[ctx.name]++;
        }

        if ( ! config.performance_monitors_stdout ) return;
        
        // Write to stout
        {
            console.log('[Monitor Snapshot]', ctx.name);
            const begin = ctx.stamps[0];
            for ( const stamp of ctx.stamps ) {
                let start = stamp.start ?? begin.ts;
                let end = stamp.end ?? stamp.ts;
                console.log('|', stamp.name,
                    (end - start) + 'ms')
            }
        }
    }

    updateMetric_ (key, value) {
        const metric = this.performanceMetrics[key] ??
            (this.performanceMetrics[key] = new Metric(30));
        metric.pushValue(value);
    }

    async recordMetrics_ () {
        // Only record metrics of CloudWatch is enabled
        if ( ! this.cw ) return;

        const MetricData = [];

        for ( let key in this.performanceMetrics ) {
            const prefix = key.replace(/\s+/g, '-');
            const metric = this.performanceMetrics[key];
            
            MetricData.push(...metric.getCloudwatchMetrics(prefix));
        }


        const Dimensions = [
            {
                Name: 'server-id',
                Value: config.server_id || 'unknown',
            },
            {
                Name: 'environment',
                Value: config.env || 'unknown',
            },
        ];

        const ts = Date.now();
        const periodInSeconds = (ts - this.lastCountPollTS) / 1000;
        for ( let key in this.operationCounts ) {
            const value = this.operationCounts[key] / periodInSeconds;
            if ( Number.isNaN(value) ) continue;
            const prefix = key.replace(/\s+/g, '-');
            MetricData.push({
                MetricName: prefix + '.operations',
                Unit: 'Count/Second',
                Value: value,
                Dimensions,
            });
            this.operationCounts[key] = 0;
        }
        this.lastCountPollTS = ts;

        const params = {
            Namespace: 'heyputer',
            MetricData,
        };

        // console.log(
        //     JSON.stringify(params, null, '  ')
        // );

        try {
            await this.cw.putMetricData(params).promise();
        } catch (e) {
            // TODO: alarm condition
            console.error(
                'Failed to send metrics to CloudWatch',
                e
            )
        }
    }
    async recordSingleMetric_ (name, value) {
        if ( Number.isNaN(value) ) {
            // occurs for averages of zero items
            return;
        }

        // Make names easier to read
        name = name.replace(/\s+/g, '-');

        const params = {
            Namespace: "heyputer",
            MetricData: [
                {
                    MetricName: name,
                    Value: value,
                    Timestamp: Math.floor(Date.now() / 1000),
                    Unit: "Milliseconds",
                    Dimensions: {
                        'server-id': config.server_id,
                        'environment': config.env,
                    }
                },
            ],
        }
        try {
            await this.cw.putMetricData(params).promise();
        } catch (e) {
            if ( ! this.services ) {
                console.error(
                    'PerformanceMonitor had an error before services were available',
                    e,
                );
                return;
            }

            const log = this.services.get('log').create('PM');
            const errors = this.services.get('error-service').create(log);
            errors.report('CloudWatch.putMetricData', {
                source: e,
                trace: true,
                alarm: true,
            });
        }
    }
}
