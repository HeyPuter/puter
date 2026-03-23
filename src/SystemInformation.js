import React, { useState, useEffect } from 'react';
import './SystemInformation.css';

function SystemInformation() {
  const [deviceInfo, setDeviceInfo] = useState({});
  const [serverSpecs, setServerSpecs] = useState({});
  const [resourceUsage, setResourceUsage] = useState({});

  useEffect(() => {
    const fetchDeviceInfo = async () => {
      const deviceInfo = {
        browser: navigator.userAgent,
        os: navigator.platform,
        screenResolution: `${screen.width}x${screen.height}`,
        cpuCores: navigator.hardwareConcurrency,
        ram: navigator.deviceMemory,
        networkInfo: navigator.connection
      };
      setDeviceInfo(deviceInfo);
    };

    const fetchServerSpecs = async () => {
      // Implement server specs fetching logic here
      const serverSpecs = {
        cpu: 'CPU Model',
        ram: 'RAM',
        diskUsage: 'Disk Usage',
        uptime: 'Uptime'
      };
      setServerSpecs(serverSpecs);
    };

    const fetchResourceUsage = async () => {
      // Implement resource usage fetching logic here
      const resourceUsage = {
        storageLimits: 'Storage Limits',
        storageUsage: 'Storage Usage',
        performanceMetrics: 'Performance Metrics',
        networkConditions: 'Network Conditions'
      };
      setResourceUsage(resourceUsage);
    };

    fetchDeviceInfo();
    fetchServerSpecs();
    fetchResourceUsage();
  }, []);

  return (
    <div className="system-information">
      <h2>Device Information</h2>
      <ul>
        <li>Browser: {deviceInfo.browser}</li>
        <li>OS: {deviceInfo.os}</li>
        <li>Screen Resolution: {deviceInfo.screenResolution}</li>
        <li>CPU Cores: {deviceInfo.cpuCores}</li>
        <li>RAM: {deviceInfo.ram} GB</li>
        <li>Network Info: {deviceInfo.networkInfo}</li>
      </ul>

      <h2>Server Specifications</h2>
      <ul>
        <li>CPU: {serverSpecs.cpu}</li>
        <li>RAM: {serverSpecs.ram} GB</li>
        <li>Disk Usage: {serverSpecs.diskUsage}</li>
        <li>Uptime: {serverSpecs.uptime}</li>
      </ul>

      <h2>Resource Usage</h2>
      <ul>
        <li>Storage Limits: {resourceUsage.storageLimits}</li>
        <li>Storage Usage: {resourceUsage.storageUsage}</li>
        <li>Performance Metrics: {resourceUsage.performanceMetrics}</li>
        <li>Network Conditions: {resourceUsage.networkConditions}</li>
      </ul>
    </div>
  );
}

export default SystemInformation;