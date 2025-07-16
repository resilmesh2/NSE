import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, firstValueFrom } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiService } from './api.service';
import { SubnetData, DeviceData, NetworkStats } from '../models/network-data';

@Injectable({
  providedIn: 'root'
})
export class NetworkDataService {
  private networkDataSubject = new BehaviorSubject<SubnetData[]>([]);
  private statsSubject = new BehaviorSubject<NetworkStats>({
    totalSubnets: 0,
    totalDevices: 0,
    highRiskSubnets: 0,
    avgRiskScore: 0
  });

  public networkData$ = this.networkDataSubject.asObservable();
  public stats$ = this.statsSubject.asObservable();

  private currentlyExpanding = new Set<string>();
  private lastExpandedData: any[] | null = null;
  private lastExpandedSubnet: string | null = null;
  private lastExpandedTime: number | null = null;

  constructor(private apiService: ApiService) {}

  async loadNetworkData(): Promise<SubnetData[]> {
  try {
    console.log('Loading network data...');
    
    const healthCheck = await firstValueFrom(this.apiService.checkApiHealth());
    if (!healthCheck) {
      console.error('Backend API not available');
      return [];
    }

    const existingData = await firstValueFrom(this.apiService.getVirtualNetworkData());
    const hasPopulatedData = this.checkIfDataIsPopulated(existingData || []);

    let networkData: any[] = [];
    
    if (hasPopulatedData) {
      console.log('Found existing populated data');
      networkData = existingData || [];
    } else {
      console.log('Populating JSON with CIDR data...');
      await firstValueFrom(this.apiService.fetchCidrData());
      await this.delay(500);
      networkData = await firstValueFrom(this.apiService.getVirtualNetworkData());
    }

    // Process virtual network data to create subnet objects
    let processedData = this.processVirtualNetworkData(networkData || []);
    
    // Check for existing subnet details and update nodes accordingly
    processedData = await this.checkExistingSubnetDetails(processedData);
    
    // Update network data with subnet information
    this.updateNetworkData(processedData);
    
    return processedData;

  } catch (error) {
    console.error('Error loading network data:', error);
    return [];
  }
}

  // Check for existing subnet details and update node properties
private async checkExistingSubnetDetails(subnets: SubnetData[]): Promise<SubnetData[]> {
  try {
    console.log('Checking for existing subnet details...');
    
    // Quick health check first
    const healthCheck = await firstValueFrom(this.apiService.checkApiHealth());
    if (!healthCheck) {
      console.log('Device details API not available, using default values');
      return subnets;
    }

    // Get existing device details data
    const existingData = await firstValueFrom(this.apiService.getDeviceDetails());
    if (!existingData || existingData.length === 0) {
      console.log('No existing device details found');
      return subnets;
    }

    // Process existing data to extract subnet information
    const subnetDetails = this.extractSubnetDetailsFromExistingData(existingData);
    
    // Update subnet objects with found details
    let updatedCount = 0;
    subnets.forEach(subnet => {
      const details = subnetDetails[subnet.subnet];
      if (details) {
        // Update device information
        subnet.deviceCount = details.deviceCount;
        subnet.devices = details.devices;
        subnet.hasDetailedData = details.deviceCount > 0;
        
        // Update risk score if found in detailed data
        if (details.riskScore !== undefined && details.riskScore > 0) {
          const previousRisk = subnet.riskScore;
          subnet.riskScore = details.riskScore;
          subnet.hasSubnetRiskScore = true;
          subnet.subnetRiskSource = 'existing_data';
          subnet.riskLevel = this.determineRiskLevel(details.riskScore);
          
          console.log(`Updated ${subnet.subnet}: devices ${details.deviceCount}, risk ${previousRisk.toFixed(1)} → ${details.riskScore.toFixed(1)} (${subnet.riskLevel})`);
        } else {
          console.log(`Updated ${subnet.subnet}: ${details.deviceCount} devices, risk unchanged: ${subnet.riskScore.toFixed(1)}`);
        }
        
        updatedCount++;
      }
    });

    console.log(`Updated ${updatedCount} subnets with existing data`);
    
    // Force update to trigger UI refresh
    this.updateNetworkData([...subnets]);
    
    return subnets;

  } catch (error) {
    console.warn('Error checking existing subnet details:', error);
    return subnets;
  }
}

// Extract subnet details from existing Cytoscape data
private extractSubnetDetailsFromExistingData(apiData: any[]): { [subnet: string]: any } {
  const subnetDetails: { [subnet: string]: any } = {};
  
  if (!apiData || apiData.length === 0) {
    return subnetDetails;
  }

  // Find all nodes (not edges)
  const cytoscapeNodes = apiData.filter(el => el.data && !el.data.source && !el.data.target);
  
  // First, look for subnet nodes with direct risk scores (ISIM data)
  const subnetNodes = cytoscapeNodes.filter(node => 
    node.data && node.data.type === 'Subnet' && node.data.label && node.data.label.includes('/24')
  );

  console.log(`Found ${subnetNodes.length} subnet nodes in existing data`);

  // Extract direct subnet risk scores
  const directSubnetRisks: { [subnet: string]: number } = {};
  subnetNodes.forEach(subnetNode => {
    const subnetCidr = subnetNode.data.label;
    
    // Extract risk score from ISIM subnet node details field
    if (subnetNode.data.details && !isNaN(parseFloat(subnetNode.data.details))) {
      const riskScore = parseFloat(subnetNode.data.details);
      directSubnetRisks[subnetCidr] = riskScore;
      console.log(`Found direct risk score for ${subnetCidr}: ${riskScore}`);
    }
  });

  // Find all IP nodes and group by subnet
  const ipNodes = cytoscapeNodes.filter(node => 
    node.data && node.data.type === 'IP' && node.data.label
  );

  // Group IP nodes by subnet (first 3 octets + /24)
  const subnetGroups: { [subnet: string]: any[] } = {};
  
  ipNodes.forEach(ipNode => {
    const ip = ipNode.data.label;
    if (ip && typeof ip === 'string') {
      const parts = ip.split('.');
      if (parts.length === 4) {
        const subnetBase = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
        if (!subnetGroups[subnetBase]) {
          subnetGroups[subnetBase] = [];
        }
        subnetGroups[subnetBase].push(ipNode);
      }
    }
  });

  // Process each subnet group
  Object.keys(subnetGroups).forEach(subnetCidr => {
    const ips = subnetGroups[subnetCidr];
    const devices: any[] = [];
    
    // Convert IP nodes to device objects
    ips.forEach(ipNode => {
      const device = this.convertIpNodeToDevice(ipNode, cytoscapeNodes, apiData);
      if (device) {
        devices.push(device);
      }
    });

    // Determine subnet risk score priority:
    // 1. Direct subnet node risk score (ISIM)
    // 2. Average of device risk scores
    // 3. Default (0)
    let subnetRiskScore = 0;
    
    if (directSubnetRisks[subnetCidr] !== undefined) {
      // Use direct subnet risk score from ISIM
      subnetRiskScore = directSubnetRisks[subnetCidr];
      console.log(`Using direct ISIM risk score for ${subnetCidr}: ${subnetRiskScore}`);
    } else if (devices.length > 0) {
      // Calculate from device averages
      const devicesWithRisk = devices.filter(d => d.riskScore > 0);
      if (devicesWithRisk.length > 0) {
        const totalRisk = devicesWithRisk.reduce((sum, device) => sum + device.riskScore, 0);
        subnetRiskScore = totalRisk / devicesWithRisk.length;
        console.log(`Calculated risk score for ${subnetCidr} from ${devicesWithRisk.length} devices: ${subnetRiskScore.toFixed(2)}`);
      }
    }

    subnetDetails[subnetCidr] = {
      deviceCount: devices.length,
      devices: devices,
      riskScore: subnetRiskScore
    };
  });

  // Also check for subnets that have direct risk scores but no device data yet
  Object.keys(directSubnetRisks).forEach(subnetCidr => {
    if (!subnetDetails[subnetCidr]) {
      subnetDetails[subnetCidr] = {
        deviceCount: 0,
        devices: [],
        riskScore: directSubnetRisks[subnetCidr]
      };
      console.log(`Added subnet with direct risk score only: ${subnetCidr} (${directSubnetRisks[subnetCidr]})`);
    }
  });

  return subnetDetails;
}

// Convert IP node to device object
private convertIpNodeToDevice(ipNode: any, allNodes: any[], allData: any[]): any {
  const edges = allData.filter(el => el.data && el.data.source && el.data.target);
  const nodeIndex = new Map();
  const edgesBySource = new Map();
  const edgesByTarget = new Map();

  // Build node and edge maps
  allNodes.forEach(nodeWrapper => {
    if (nodeWrapper?.value || nodeWrapper?.data) {
      const node = nodeWrapper.value || nodeWrapper.data;
      const nodeId = nodeWrapper.v || nodeWrapper.data.id;
      nodeIndex.set(nodeId, node);
    }
  });

  edges.forEach(edge => {
    const sourceId = edge.v || edge.data.source;
    const targetId = edge.w || edge.data.target;
    if (!edgesBySource.has(sourceId)) edgesBySource.set(sourceId, []);
    if (!edgesByTarget.has(targetId)) edgesByTarget.set(targetId, []);
    edgesBySource.get(sourceId).push(edge);
    edgesByTarget.get(targetId).push(edge);
  });

  // Extract device information using existing logic
  return this.extractDeviceFromIP(ipNode.data, nodeIndex, edgesBySource, edgesByTarget);
}

  async getSubnetDetails(subnetCidr: string, progressCallback?: (message: string) => void): Promise<{ devices: DeviceData[], nodes: any[], vulnerabilities: string[] }> {
  const updateProgress = (message: string) => {
    console.log(` ${message}`);
    if (progressCallback) progressCallback(message);
  };

  try {
    // Check cache first
    if (this.isCacheValid() && this.lastExpandedSubnet === subnetCidr) {
      updateProgress('Using cached data - almost instant...');
      await this.delay(300);
      return this.processSubnetDetailData(this.lastExpandedData!, subnetCidr);
    }

    // Check if expansion is already in progress
    if (this.currentlyExpanding.has(subnetCidr)) {
      updateProgress('Expansion already in progress, waiting...');
      await this.waitForExpansion(subnetCidr);
      return this.processSubnetDetailData(this.lastExpandedData!, subnetCidr);
    }

    this.currentlyExpanding.add(subnetCidr);

    updateProgress('Step 1: Checking if data is already populated...');
    
    let currentData = await firstValueFrom(this.apiService.getDeviceDetails());
    const isAlreadyPopulated = this.checkIfDeviceDataIsPopulated(currentData || [], subnetCidr);
    
    if (isAlreadyPopulated) {
      updateProgress('Data already populated - using existing device information...');
      
      // Cache the data
      this.lastExpandedData = currentData || [];
      this.lastExpandedSubnet = subnetCidr;
      this.lastExpandedTime = Date.now();
      
      return this.processSubnetDetailData(currentData || [], subnetCidr);
    }

    updateProgress('Step 2: Triggering subnet search...');
    
    // Step 1: Trigger subnet search
    await firstValueFrom(this.apiService.fetchSubnetDetails(subnetCidr));
    
    updateProgress('Step 3: Expanding subnet node...');
    
    // Step 2: Get initial data and expand nodes
    await this.delay(1500);
    currentData = await firstValueFrom(this.apiService.getDeviceDetails());
    
    // Step 3: Expand subnet nodes
    const subnetNode = (currentData || []).find((el: any) => 
      el.data && el.data.type === 'Subnet' && el.data.label === subnetCidr
    );

    if (subnetNode) {
      await firstValueFrom(this.apiService.expandVirtualNetwork(subnetNode.data.id, 'Subnet'));
      await this.delay(1500);
      currentData = await firstValueFrom(this.apiService.getDeviceDetails());

      updateProgress('Step 4: Expanding /32 subnets...');
      
      // Step 4: Expand all /32 subnet nodes WITH progress tracking
      await this.expandAllSubnetNodes(currentData || [], progressCallback);
      
      updateProgress('Step 5: Expanding IP nodes...');
      
      // Step 5: Expand all IP nodes WITH progress tracking
      await this.expandAllIpNodes(currentData || [], subnetCidr, progressCallback);
      
      updateProgress('Step 6: Loading device details...');
      
      // Final fetch
      await this.delay(2000);
      const finalData = await firstValueFrom(this.apiService.getDeviceDetails());
      
      // Cache the data
      this.lastExpandedData = finalData || [];
      this.lastExpandedSubnet = subnetCidr;
      this.lastExpandedTime = Date.now();
      
      updateProgress('Processing device data...');
      
      return this.processSubnetDetailData(finalData || [], subnetCidr);
    }

    return { devices: [], nodes: [], vulnerabilities: [] };

  } catch (error) {
    console.error('Error fetching subnet details:', error);
    updateProgress('Error loading data - using available information');
    return { devices: [], nodes: [], vulnerabilities: [] };
  }finally {
  this.currentlyExpanding.delete(subnetCidr);
  
  const currentNetworkData = this.getCurrentNetworkData();
  const subnetToUpdate = currentNetworkData.find(s => s.subnet === subnetCidr);
  if (subnetToUpdate && this.lastExpandedData) {
    const deviceCount = this.processSubnetDetailData(this.lastExpandedData, subnetCidr).devices.length;
    subnetToUpdate.deviceCount = deviceCount;
    subnetToUpdate.hasDetailedData = true;
    
    // Update the network data to trigger UI refresh
    this.updateNetworkData(currentNetworkData);
    console.log(`Updated ${subnetCidr} device count to ${deviceCount}`);
  }
}
}

private checkIfDeviceDataIsPopulated(apiData: any[], subnetCidr: string): boolean {
  if (!apiData || apiData.length === 0) {
    return false;
  }

  // Check if there are IP nodes for this subnet
  const networkPrefix = subnetCidr.split('/')[0].split('.').slice(0, 3).join('.');
  
  // Look for nodes and edges in the data
  const cytoscapeNodes = apiData.filter(el => el.data && !el.data.source && !el.data.target);
  const ipNodes = cytoscapeNodes.filter((nodeWrapper: any) => {
    const node = nodeWrapper.value || nodeWrapper.data;
    return node.type === 'IP' && node.label && node.label.startsWith(networkPrefix + '.');
  });

  // If we have IP nodes for this subnet, consider it populated
  const hasIpNodes = ipNodes.length > 0;
  
  console.log(`Checking if data is populated for ${subnetCidr}: found ${ipNodes.length} IP nodes`);
  
  return hasIpNodes;
}

  // Process virtual network data from API
  private processVirtualNetworkData(virtualNetworkData: any[]): SubnetData[] {
  if (!virtualNetworkData || !Array.isArray(virtualNetworkData) || virtualNetworkData.length === 0) {
    return [];
  }

  const cidrValuesNode = virtualNetworkData.find(item => 
    item.data && item.data.type === 'CIDR_Values'
  );

  if (!cidrValuesNode) {
    console.warn('No CIDR_Values node found');
    return [];
  }

  const allSubnets = cidrValuesNode.data.details || [];
  const subnets = allSubnets.filter((subnet: string) => {
    if (!subnet || typeof subnet !== 'string' || !subnet.includes('/')) return false;
    const [, cidrPart] = subnet.split('/');
    const cidr = parseInt(cidrPart);
    return cidr >= 16 && cidr <= 30;
  });

  const vulnerableSubnets = cidrValuesNode.data.vulns || [];

  // Extract existing subnet risk scores from ISIM data
  const existingSubnetScores = this.extractSubnetRiskScores(virtualNetworkData);

  return subnets.map((subnet: string, index: number) => {
    const isVulnerable = vulnerableSubnets.includes(subnet);
    const [networkPart, cidrPart] = subnet.split('/');
    const cidr = parseInt(cidrPart);
    const maxPossibleDevices = Math.pow(2, 32 - cidr) - 2;

    const neoRiskData = existingSubnetScores[subnet];
    const riskScore = neoRiskData?.riskScore || 0.0;
    const riskLevel = neoRiskData?.riskLevel || this.determineRiskLevel(riskScore);
    const hasSubnetRiskScore = !!neoRiskData;

    console.log(`Processing subnet ${subnet}: ISIM risk score = ${riskScore} (${riskLevel}), source = ${hasSubnetRiskScore ? 'ISIM' : 'default'}`);

    return {
      id: `subnet-${index}`,
      subnet,
      deviceCount: 0, // Will be updated when device data is loaded
      riskScore,
      riskLevel,
      devices: [],
      isVulnerable,
      networkSize: cidr,
      maxDevices: maxPossibleDevices,
      networkPart,
      hasDetailedData: false,
      hasSubnetRiskScore,
      subnetRiskSource: hasSubnetRiskScore ? 'ISIM' : 'default'
    } as SubnetData;
  });
}

private extractSubnetRiskScores(virtualNetworkData: any[]): { [subnet: string]: { riskScore: number, riskLevel: string } } {
  const scores: { [subnet: string]: { riskScore: number, riskLevel: string } } = {};
  
  // Look for Subnet nodes with risk scores in the initial data
  const subnetNodes = virtualNetworkData.filter(item => 
    item.data && item.data.type === 'Subnet' && item.data.label && item.data.label.includes('/24')
  );
  
  console.log(`Found ${subnetNodes.length} subnet nodes in initial data for risk score extraction`);
  
  subnetNodes.forEach(subnetNode => {
    const subnetCidr = subnetNode.data.label;
    
    // Extract risk score from ISIM subnet node details field
    if (subnetNode.data.details && !isNaN(parseFloat(subnetNode.data.details))) {
      const riskScore = parseFloat(subnetNode.data.details);
      const riskLevel = this.determineRiskLevel(riskScore);
      
      scores[subnetCidr] = { riskScore, riskLevel };
      console.log(` Extracted ISIM risk score for ${subnetCidr}: ${riskScore} (${riskLevel})`);
    } else {
      console.log(` No risk score found in details for ${subnetCidr}: ${subnetNode.data.details}`);
    }
  });
  
  console.log(`Total subnet risk scores extracted: ${Object.keys(scores).length}`);
  return scores;
}

  private processSubnetDetailData(apiData: any[], subnetCidr: string): { devices: DeviceData[], nodes: any[], vulnerabilities: string[] } {
  const networkPrefix = subnetCidr.split('/')[0].split('.').slice(0, 3).join('.');
  console.log(`Processing subnet: ${subnetCidr}, using network prefix: ${networkPrefix}`);
  
  const devices: DeviceData[] = [];
  const nodes: any[] = [];
  const vulnerabilities: string[] = [];

  if (!apiData) {
    return { devices, nodes, vulnerabilities };
  }

  // Process Cytoscape format data
  const cytoscapeNodes = apiData.filter(el => el.data && !el.data.source && !el.data.target);
  const cytoscapeEdges = apiData.filter(el => el.data && el.data.source && el.data.target);

  // Extract subnet risk score from ISIM during expansion
  const subnetNode = cytoscapeNodes.find(el => 
    el.data && el.data.type === 'Subnet' && el.data.label === subnetCidr
  );

  if (subnetNode) {
    const subnetNodeData = subnetNode.data;
    console.log(`Found subnet node during expansion:`, subnetNodeData);
    
    // Extract Risk Score from subnet node if available
    if (subnetNodeData.details && !isNaN(parseFloat(subnetNodeData.details))) {
      const subnetRiskScore = parseFloat(subnetNodeData.details);
      console.log(` Subnet has Risk Score from ISIM during expansion: ${subnetRiskScore}`);
      
      // Find the subnet object in current network data and update it
      const currentNetworkData = this.getCurrentNetworkData();
      const subnetObj = currentNetworkData.find(s => s.subnet === subnetCidr);
      if (subnetObj) {
        subnetObj.riskScore = subnetRiskScore;
        subnetObj.hasSubnetRiskScore = true;
        subnetObj.subnetRiskSource = 'ISIM_expansion';
        subnetObj.riskLevel = this.determineRiskLevel(subnetRiskScore);
        
        console.log(` Updated subnet during expansion with ISIM Risk Score: ${subnetRiskScore} (${subnetObj.riskLevel})`);
        
        // Update the network data to trigger UI updates
        this.updateNetworkData(currentNetworkData);
      }
    } else {
      console.log(` Subnet node found but no Risk Score in details during expansion: ${subnetNodeData.details}`);
    }
  } else {
    console.log(` Subnet node not found in expanded data for: ${subnetCidr}`);
  }

  const nodeIndex = new Map();
  const edgesBySource = new Map();
  const edgesByTarget = new Map();

  cytoscapeNodes.forEach(nodeWrapper => {
    if (nodeWrapper?.value || nodeWrapper?.data) {
      const node = nodeWrapper.value || nodeWrapper.data;
      const nodeId = nodeWrapper.v || nodeWrapper.data.id;
      node.id = nodeId;
      nodeIndex.set(nodeId, node);
      nodes.push(node);
    }
  });

  cytoscapeEdges.forEach(edge => {
    const sourceId = edge.v || edge.data.source;
    const targetId = edge.w || edge.data.target;
    const relationshipType = edge.value?.type || edge.data.label || edge.data.type;

    if (!edgesBySource.has(sourceId)) edgesBySource.set(sourceId, []);
    if (!edgesByTarget.has(targetId)) edgesByTarget.set(targetId, []);

    const edgeData = {
      source: sourceId,
      target: targetId,
      type: relationshipType,
      id: edge.value?.id || edge.data.id
    };

    edgesBySource.get(sourceId).push(edgeData);
    edgesByTarget.get(targetId).push(edgeData);
  });

  // Find IP nodes in the subnet
  const subnetIPs = Array.from(nodeIndex.values()).filter((node: any) =>
    node.type === 'IP' && node.label && node.label.startsWith(networkPrefix + '.')
  );

  console.log(`Found ${subnetIPs.length} IP nodes in subnet ${networkPrefix}.x`);

  // Process each IP to extract device information
  subnetIPs.forEach((ipNode: any) => {
    const device = this.extractDeviceFromIP(ipNode, nodeIndex, edgesBySource, edgesByTarget);
    if (device) {
      devices.push(device);
    }
  });

  // Extract vulnerabilities
  nodeIndex.forEach((node: any) => {
    if (node.type === 'Vulnerability' || node.type === 'CVE') {
      vulnerabilities.push(node.label || node.id);
    }
  });

  console.log(`Processed ${subnetCidr}: Found ${devices.length} devices`);

  // Update the subnet in current network data
  const currentNetworkData = this.getCurrentNetworkData();
  const subnetToUpdate = currentNetworkData.find(s => s.subnet === subnetCidr);
  if (subnetToUpdate) {
    subnetToUpdate.deviceCount = devices.length;
    subnetToUpdate.devices = devices;
    subnetToUpdate.hasDetailedData = true;
    this.updateNetworkData(currentNetworkData);
  }

  return { devices, nodes, vulnerabilities };
}

  // Extract device information from IP node
  private extractDeviceFromIP(ipNode: any, nodeIndex: Map<string, any>, edgesBySource: Map<string, any[]>, edgesByTarget: Map<string, any[]>): DeviceData | null {
  const deviceInfo: DeviceData = {
  id: `device-${ipNode.id}`,
  ip: String(ipNode.label || ''), // Convert to string
  hostname: '',
  deviceType: 'Network Device',
  os: 'Unknown',
  riskScore: 0.0,
  vulnerabilities: [],
  isDevice: true,
  sourceData: ipNode
};

  const ipId = ipNode.id;
  const outgoingEdges = edgesBySource.get(ipId) || [];
  const incomingEdges = edgesByTarget.get(ipId) || [];

  // Find hostname via RESOLVES_TO relationship
const resolvesToEdge = outgoingEdges.find((edge: any) => edge.type === 'RESOLVES_TO');
if (resolvesToEdge) {
  const domainNode = nodeIndex.get(resolvesToEdge.target);
  if (domainNode && domainNode.type === 'DomainName') {
    deviceInfo.hostname = String(domainNode.label || ''); // Convert to string
  }
}

  // Find the node that HAS_ASSIGNED this IP
  const hasAssignedEdge = incomingEdges.find((edge: any) => edge.type === 'HAS_ASSIGNED');
  
  if (hasAssignedEdge) {
    const assigningNode = nodeIndex.get(hasAssignedEdge.source);
    
    if (assigningNode) {
      // Extract risk score from the assigning node
      if (assigningNode.label && !isNaN(parseFloat(assigningNode.label))) {
        deviceInfo.riskScore = parseFloat(assigningNode.label);
        console.log(`Got device risk score from node label: ${deviceInfo.riskScore}`);
      } else if (assigningNode.details && !isNaN(parseFloat(assigningNode.details))) {
        deviceInfo.riskScore = parseFloat(assigningNode.details);
        console.log(`Got device risk score from node details: ${deviceInfo.riskScore}`);
      }

      // Find Host node via IS_A relationship from the assigning node
      const assigningNodeEdges = edgesBySource.get(hasAssignedEdge.source) || [];
      const isAEdge = assigningNodeEdges.find((edge: any) => edge.type === 'IS_A');

      if (isAEdge) {
        const hostNode = nodeIndex.get(isAEdge.target);
        if (hostNode && hostNode.type === 'Host') {
          // Find SoftwareVersion via ON relationship (Software -> Host)
          const softwareOnHostEdges = edgesByTarget.get(isAEdge.target) || [];
          const onEdges = softwareOnHostEdges.filter((edge: any) => edge.type === 'ON');

          onEdges.forEach((onEdge: any) => {
            const softwareNode = nodeIndex.get(onEdge.source);
            if (softwareNode && softwareNode.type === 'SoftwareVersion') {
              deviceInfo.os = this.extractOSFromSoftware(softwareNode.label);
              
              const softwareIncomingEdges = edgesByTarget.get(onEdge.source) || [];
              const inEdges = softwareIncomingEdges.filter((edge: any) => edge.type === 'IN');

              inEdges.forEach((inEdge: any) => {
                const vulnNode = nodeIndex.get(inEdge.source);
                if (vulnNode && vulnNode.type === 'Vulnerability') {
                  // Find CVE via REFERS_TO
                  const vulnOutgoingEdges = edgesBySource.get(inEdge.source) || [];
                  const refersToEdge = vulnOutgoingEdges.find((edge: any) => edge.type === 'REFERS_TO');

                  if (refersToEdge) {
                    const cveNode = nodeIndex.get(refersToEdge.target);
                    if (cveNode && cveNode.type === 'CVE') {
                      const cveId = this.extractCVEIdentifier(cveNode, vulnNode);
                      if (cveId) {
                        deviceInfo.vulnerabilities.push(cveId);
                      }
                    }
                  } else {
                    deviceInfo.vulnerabilities.push(vulnNode.label || 'Unknown Vulnerability');
                  }
                }
              });
            }
          });
        }
      }
    }
  }

  // Set device type based on OS and hostname
  deviceInfo.deviceType = this.determineDeviceType(deviceInfo.os, deviceInfo.hostname);

  // Use fallback hostname if none found
if (!deviceInfo.hostname) {
  const lastOctet = String(deviceInfo.ip || '').split('.').pop();
  deviceInfo.hostname = `host-${lastOctet}`;
}

if (deviceInfo.riskScore === 0.0) {
  deviceInfo.hasRiskScore = false;
  console.log(`No risk score found for ${deviceInfo.ip}, keeping at 0.0`);
} else {
  deviceInfo.hasRiskScore = true;
  console.log(`Found ISIM risk score for ${deviceInfo.ip}: ${deviceInfo.riskScore.toFixed(1)}`);
}

  // Add fake data for ports, last seen, and status
  (deviceInfo as any).openPorts = this.generatePortsForDevice(deviceInfo.deviceType, deviceInfo.os);
  (deviceInfo as any).lastSeen = this.getRandomRecentDate();
  (deviceInfo as any).status = this.getRandomStatus();

  return deviceInfo;
}

  private async expandAllSubnetNodes(currentData: any[], progressCallback?: (message: string) => void): Promise<void> {
  const subnetNodes = currentData.filter(el => 
    el.data && el.data.type === 'Subnet' && el.data.label && el.data.label.includes('/32')
  );

  console.log(`Expanding ${subnetNodes.length} /32 subnet nodes`);
  
  if (progressCallback) {
    progressCallback(`Found ${subnetNodes.length} /32 subnets to expand...`);
  }

  if (subnetNodes.length === 0) {
    console.log('No /32 subnet nodes found to expand');
    return;
  }

  const subnetBatchSize = 5;
  const totalBatches = Math.ceil(subnetNodes.length / subnetBatchSize);
  
  for (let i = 0; i < subnetNodes.length; i += subnetBatchSize) {
    const batch = subnetNodes.slice(i, i + subnetBatchSize);
    const currentBatch = Math.floor(i / subnetBatchSize) + 1;
    
    console.log(`Processing /32 subnet batch ${currentBatch}/${totalBatches} (${batch.length} subnets)`);
    
    if (progressCallback) {
      progressCallback(`Expanding /32 subnet batch ${currentBatch}/${totalBatches}`);
    }
    
    for (const subnetNode of batch) {
      console.log(`  Expanding /32 subnet: ${subnetNode.data.label}`);
      
      try {
        await firstValueFrom(this.apiService.expandVirtualNetwork(subnetNode.data.id, 'Subnet'));
        await this.delay(500);
      } catch (error) {
        console.log(`  Error expanding subnet ${subnetNode.data.label}:`, error);
      }
    }
    
    await this.delay(1000);
  }
  
  console.log(`Completed expansion of all ${subnetNodes.length} /32 subnet nodes`);
  if (progressCallback) {
    progressCallback(`Completed /32 subnet expansion`);
  }
}

  private async expandAllIpNodes(currentData: any[], subnetCidr: string, progressCallback?: (message: string) => void): Promise<void> {
  const networkPrefix = subnetCidr.split('/')[0].split('.').slice(0, 3).join('.');
  const ipNodes = currentData.filter(el => 
    el.data && el.data.type === 'IP' && el.data.label && el.data.label.startsWith(networkPrefix + '.')
  );

  console.log(`Found ${ipNodes.length} IP nodes in subnet ${networkPrefix}.x - expanding ALL of them`);
  
  if (progressCallback) {
    progressCallback(`Found ${ipNodes.length} IP nodes to expand...`);
  }

  if (ipNodes.length === 0) {
    console.log('No IP nodes found to expand');
    if (progressCallback) {
      progressCallback('No IP nodes found to expand');
    }
    return;
  }

  const ipBatchSize = 10;
  const totalBatches = Math.ceil(ipNodes.length / ipBatchSize);
  
  console.log(`Will process ${totalBatches} batches of up to ${ipBatchSize} IPs each`);
  
  for (let i = 0; i < ipNodes.length; i += ipBatchSize) {
    const batch = ipNodes.slice(i, i + ipBatchSize);
    const currentBatch = Math.floor(i / ipBatchSize) + 1;
    
    console.log(`Processing IP batch ${currentBatch}/${totalBatches} (${batch.length} IPs)`);
    
    // Update both console and popup with batch progress
    const batchMessage = `Expanding IP batch ${currentBatch}/${totalBatches} (${batch.length} IPs)`;
    if (progressCallback) {
      progressCallback(batchMessage);
    }
    
    for (const ipNode of batch) {
      console.log(`  Expanding IP node: ${ipNode.data.label}`);
      
      try {
        const expandIpResponse = await firstValueFrom(
          this.apiService.expandVirtualNetwork(ipNode.data.id, 'IP')
        );
        
        if (expandIpResponse) {
          await this.delay(300);
        }
      } catch (err) {
        console.log(`  Error expanding IP ${ipNode.data.label}:`, err);
      }
    }
    
    // Brief pause between batches
    await this.delay(800);
    
    // Update progress with completion of current batch
    if (progressCallback && currentBatch < totalBatches) {
      progressCallback(`Completed batch ${currentBatch}/${totalBatches}, continuing...`);
    }
  }
  
  console.log(`Completed expansion of all ${ipNodes.length} IP nodes`);
  if (progressCallback) {
    progressCallback(`Completed expansion of all ${ipNodes.length} IP nodes`);
  }
}

  private extractOSFromSoftware(softwareLabel: string): string {
  const labelStr = String(softwareLabel || ''); // Convert to string first
  if (!labelStr) return 'Unknown';
  
  const lower = labelStr.toLowerCase();
  
  if (lower.includes('microsoft:windows_10')) return 'Windows 10';
  if (lower.includes('microsoft:windows_server_2019')) return 'Windows Server 2019';
  if (lower.includes('microsoft:windows_server_2016')) return 'Windows Server 2016';
  if (lower.includes('microsoft:windows_server')) return 'Windows Server';
  if (lower.includes('microsoft:windows')) return 'Windows';
  if (lower.includes('ubuntu')) return 'Ubuntu Linux';
  if (lower.includes('centos')) return 'CentOS Linux';
  if (lower.includes('redhat')) return 'Red Hat Linux';
  if (lower.includes('linux')) return 'Linux';
  if (lower.includes('macos')) return 'macOS';
  
  return 'Unknown';
}

  private determineDeviceType(os: string, hostname: string): string {
  const osLower = String(os || '').toLowerCase();
  const hostLower = String(hostname || '').toLowerCase();  // Convert to string first
  
  if (hostLower.includes('server') || hostLower.includes('srv')) return 'Server';
  if (hostLower.includes('router') || hostLower.includes('gw')) return 'Router';
  if (hostLower.includes('switch') || hostLower.includes('sw')) return 'Switch';
  if (hostLower.includes('printer')) return 'Printer';
  if (hostLower.includes('firewall') || hostLower.includes('fw')) return 'Firewall';
  
  if (osLower.includes('server')) return 'Server';
  if (osLower.includes('windows') && !osLower.includes('server')) return 'Workstation';
  if (osLower.includes('linux') || osLower.includes('ubuntu') || osLower.includes('centos')) return 'Server';
  
  return 'Network Device';
}

  private extractCVEIdentifier(cveNode: any, fallbackNode?: any): string | null {
    if (cveNode?.cve_id) {
      return `CVE-2023-${cveNode.cve_id}`;
    }
    
    const fieldsToCheck = ['label', 'name', 'identifier', 'id'];
    for (const field of fieldsToCheck) {
      if (cveNode[field]) {
        const cveMatch = this.extractCVEFromText(cveNode[field]);
        if (cveMatch) return cveMatch;
      }
    }
    
    if (fallbackNode?.cve_id) {
      return `CVE-2023-${fallbackNode.cve_id}`;
    }
    
    return cveNode?.id ? `CVE-2023-${cveNode.id}` : null;
  }

  private extractCVEFromText(text: string): string | null {
    if (!text) return null;
    
    const cvePattern = /CVE-\d{4}-\d{4,}/i;
    const match = text.match(cvePattern);
    return match ? match[0].toUpperCase() : null;
  }

  private checkIfDataIsPopulated(data: any[]): boolean {
    if (!data || !Array.isArray(data) || data.length === 0) return false;
    
    const cidrValuesNode = data.find(item => 
      item.data && item.data.type === 'CIDR_Values'
    );
    
    if (!cidrValuesNode) return false;
    
    const hasDetails = cidrValuesNode.data.details && 
                      Array.isArray(cidrValuesNode.data.details) && 
                      cidrValuesNode.data.details.length > 0;
                      
    const hasVulns = cidrValuesNode.data.vulns && 
                    Array.isArray(cidrValuesNode.data.vulns);
    
    return hasDetails && hasVulns;
  }

 // FAKE DATA GENERATORS (only for ports, last seen, status)
private generatePortsForDevice(deviceType: string, os: string): number[] {
  const basePortsByType: { [key: string]: number[] } = {
    'Server': [22, 80, 443, 3389, 21, 25, 993, 995, 143, 110],
    'Web Server': [80, 443, 8080, 8443, 22],
    'Mail Server': [25, 143, 993, 995, 587, 110, 22],
    'Database Server': [3306, 5432, 1433, 1521, 27017, 22],
    'Workstation': [22, 3389, 5985, 135, 139, 445],
    'Router': [22, 23, 80, 443, 161, 162],
    'Switch': [22, 23, 80, 443, 161, 162],
    'Firewall': [22, 443, 161, 162],
    'Printer': [80, 443, 515, 631, 9100],
    'Mobile Device': [80, 443],
    'Network Device': [22, 80, 443, 161]
  };
  
  let basePorts = basePortsByType[deviceType] || basePortsByType['Network Device'];
  
  // Add OS-specific ports
  const osLower = os.toLowerCase();
  if (osLower.includes('windows')) {
    basePorts = [...basePorts, 135, 139, 445, 3389, 5985];
  } else if (osLower.includes('linux') || osLower.includes('ubuntu') || osLower.includes('centos')) {
    basePorts = [...basePorts, 22, 80, 443];
  }
  
  // Return 3-7 unique ports
  const uniquePorts = [...new Set(basePorts)];
  const numPorts = Math.min(Math.max(3, Math.floor(Math.random() * 5) + 3), uniquePorts.length);
  return uniquePorts.slice(0, numPorts).sort((a, b) => a - b);
}

private getRandomRecentDate(): string {
  const now = new Date();
  const hoursAgo = Math.floor(Math.random() * 168);
  
  if (hoursAgo < 1) return 'Just now';
  if (hoursAgo < 24) return `${hoursAgo}h ago`;
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo}d ago`;
}

private getRandomStatus(): string {
  const statuses = ['Online', 'Online', 'Online', 'Offline'];
  return statuses[Math.floor(Math.random() * statuses.length)];
}

  private determineRiskLevel(riskScore: number): 'low' | 'medium' | 'high' | 'critical' {
  if (riskScore >= 8.0) return 'critical';
  if (riskScore >= 6.0) return 'high';
  if (riskScore >= 4.0) return 'medium';
  return 'low';
}

  private isCacheValid(): boolean {
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  
  if (!this.lastExpandedData || !this.lastExpandedTime) {
    return false;
  }
  
  return (Date.now() - this.lastExpandedTime) < CACHE_DURATION;
}

  private async waitForExpansion(subnetCidr: string): Promise<void> {
    let waitTime = 0;
    while (this.currentlyExpanding.has(subnetCidr) && waitTime < 120000) {
      await this.delay(2000);
      waitTime += 2000;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private updateNetworkData(data: SubnetData[]): void {
    this.networkDataSubject.next(data);
    this.updateStats(data);
  }

  private updateStats(data: SubnetData[]): void {
    const stats: NetworkStats = {
      totalSubnets: data.length,
      totalDevices: data.reduce((sum, subnet) => sum + subnet.deviceCount, 0),
      highRiskSubnets: data.filter(subnet => subnet.riskLevel === 'high' || subnet.riskLevel === 'critical').length,
      avgRiskScore: data.length > 0 ? data.reduce((sum, subnet) => sum + subnet.riskScore, 0) / data.length : 0
    };
    this.statsSubject.next(stats);
  }

  // Public getters
  getCurrentNetworkData(): SubnetData[] {
    return this.networkDataSubject.value;
  }

  getCurrentStats(): NetworkStats {
    return this.statsSubject.value;
  }

updateSubnetDeviceCount(subnetCidr: string, deviceCount: number): void {
  const currentData = this.getCurrentNetworkData();
  const subnet = currentData.find(s => s.subnet === subnetCidr);
  if (subnet) {
    subnet.deviceCount = deviceCount;
    subnet.hasDetailedData = true;
    this.updateNetworkData(currentData);
    console.log(`Updated ${subnetCidr}: ${deviceCount} devices`);
  }
}
}