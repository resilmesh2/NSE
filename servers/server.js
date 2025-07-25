const express = require('express');
const path = require('path');
const neo4j = require('neo4j-driver');
const cors = require('cors');
require('dotenv').config();
const graphlib = require('graphlib');
const fs = require('fs');

// For CIDR operations
const CIDR = require('cidr-js');

// Single virtual network for all functionality
let virtualNetwork = new graphlib.Graph();

// Neo4j credentials
const uri = process.env.NEO4J_SERVER_URL || 'bolt://localhost:7687';
const user = process.env.NEO4J_USERNAME || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'supertestovaciheslo';
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

// Initialize Express.js
const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, '../resilmesh-dashboard/src/assets')));
app.use(express.json());

app.use(cors({
    origin: '*',
    methods: 'GET,POST',
    allowedHeaders: 'Content-Type,Authorization'
}));

// Single file path for virtual network cache
const virtualNetworkFilePath = path.join(__dirname, 'data', 'virtualNetwork.json');

// Configuration
const CACHE_MAX_AGE_HOURS = 24;

// Neo4j query functions from both servers

// From port 3001 server - comprehensive data loading
async function getInitialData() {
    console.log("====== Beginning Data Collection ======");
    console.time("Total Data Collection");
    
    const session = driver.session();

    try {
        console.log("Step 1: Executing main Neo4j query...");
        console.time("Main Neo4j Query");
        
        const query = `MATCH (o:OrganizationUnit)-[r]-(s:Subnet), (s)-[r2]-(i:IP) ` +
                     `RETURN o, r, s, i;`;

        const result = await session.run(query);
        console.timeEnd("Main Neo4j Query");
        
        console.log(`Step 2: Processing ${result.records.length} records...`);
        console.time("Record Processing");

        const elements = [];
        const ranges = [];
        let orgNodeId = null;
        let nodeType = null;
        let orgNodeDetails = null;
        let orgNodeLabel = null;
        let nodeRanges = [];
        let nodeHosts = [];
        let vulnNodeHosts = [];
        let nodeRels = [];
        let cidr_rangeId = null;
        const uniqueOrgUnitIds = new Set();
        let noRels = 0;
        let noSubnets = 0;

        result.records.forEach(record => {
            record.keys.forEach(key => {
                const value = record.get(key);

                if (value.labels) {
                    if (value.labels.includes('Subnet')) {
                        nodeRanges.push(value);
                        noSubnets++;
                    } else if (value.labels.includes('OrganizationUnit')) {
                        orgNodeId = value.identity.low;
                        cidr_rangeId = `CIDR_range-${orgNodeId}`;

                        if (!uniqueOrgUnitIds.has(orgNodeId)) {
                            uniqueOrgUnitIds.add(orgNodeId);
                            nodeType = value.labels[0];
                            orgNodeLabel = value.properties.name;
                            orgNodeDetails = "N/A";
                        }
                    } else if (value.labels.includes('IP')){
                        const ipNodeAddress = value.properties.address;
                        if (!nodeHosts.includes(ipNodeAddress)){
                            nodeHosts.push(ipNodeAddress);
                        }
                    }
                } else if (value.type) {
                    nodeRels.push(value);
                    noRels++;
                }
            });
        });

        console.timeEnd("Record Processing");
        console.log(`  - Found ${noSubnets} subnets`);
        console.log(`  - Found ${nodeHosts.length} unique IP addresses`);
        console.log(`  - Found ${noRels} relationships`);

        console.log("Step 3: Executing vulnerability query...");
        console.time("Vulnerability Query");
        
        const query2 = `MATCH (i:IP)-[r]-(n:Node), (n)-[r2]-(h:Host), ` +
                      `(h)-[r3]-(sv:SoftwareVersion), (sv)-[r4]-(v:Vulnerability) ` +
                      `RETURN i, count(v);`;

        const vulnResult = await session.run(query2);
        console.timeEnd("Vulnerability Query");
        
        console.log(`Step 4: Processing ${vulnResult.records.length} vulnerability records...`);
        console.time("Vulnerability Processing");

        vulnResult.records.forEach(vulnRecord => {
            let ipNodeAddress = null;

            vulnRecord.keys.forEach(vulnKey => {
                const vulnValue = vulnRecord.get(vulnKey);

                if (vulnValue.labels) {
                    if (vulnValue.labels.includes('IP')) {
                        ipNodeAddress = vulnValue.properties.address;
                    }
                } else if (vulnValue.low !== undefined) {
                    if (ipNodeAddress) {
                        vulnNodeHosts.push(ipNodeAddress);
                    }
                }
            });
        });

        console.timeEnd("Vulnerability Processing");
        console.log(`  - Found ${vulnNodeHosts.length} IPs with vulnerabilities`);

        console.log("Step 5: Building data structure...");
        console.time("Data Structure Building");

        const ipHosts = nodeHosts.map(element => `${element}/32`);
        const vulnHosts = vulnNodeHosts.map(element => `${element}/32`);

        function processDuplicates(myArray){
            const results = [];
            const recordedEleIds = new Set();

            myArray.forEach(ele => {
                const idValue = ele.identity.low;
                if (!recordedEleIds.has(idValue)){
                    recordedEleIds.add(idValue);
                    results.push(ele);
                }
            });

            return results;
        }

        const netRanges = processDuplicates(nodeRanges);

        netRanges.forEach(ele => {
            const value = ele.properties['range'];
            ranges.push(value);
        });

        const netNodeValues = Array.from(new Set([...ranges, ...ipHosts]));

        elements.push({
            data : {
                id: orgNodeId,
                type: 'CIDR_Values',
                label: orgNodeLabel,
                details: netNodeValues,
                vulns: vulnHosts
            }
        });

        console.timeEnd("Data Structure Building");
        console.timeEnd("Total Data Collection");
        
        console.log("====== Data Collection Complete ======");
        console.log(`Final Results:`);
        console.log(`  - Total elements: ${elements.length}`);
        console.log(`  - Subnets: ${noSubnets}`);
        console.log(`  - IPs: ${nodeHosts.length}`);
        console.log(`  - Vulnerable IPs: ${vulnNodeHosts.length}`);
        console.log(`  - Network ranges in details: ${netNodeValues.length}`);

        return elements;

    } catch (error) {
        console.timeEnd("Total Data Collection");
        console.error('Error fetching initial CIDR notation from Neo4j:', error);
        return [];
    } finally {
        console.log("Step 6: Closing Neo4j session...");
        await session.close();
    }
}

// From port 3000 server - detailed subnet node queries
async function getInitialSubnetNode(netRange){
    const session = driver.session();

    try {
        let query = `MATCH (s:Subnet) WHERE s.range IN ["${netRange}"] RETURN s;`;
        const result = await session.run(query);
        const elements = [];
        let nodeId = null;
        let nodeType = 'Subnet';
        let nodeDetails = null;
        let nodeLabel = null;

        result.records.forEach(record => {
            record.keys.forEach(key => {
                const node = record.get(key);
                if (node && node.labels) {
                    nodeId = node.identity.low;
                    nodeDetails = node.properties.note;
                    nodeLabel = node.properties.range;
                }
            });
        });

        elements.push({
            data: {
                id: nodeId,
                type: nodeType,
                label: nodeLabel,
                details: nodeDetails
            }
        });

        return elements;
    } catch (error) {
        console.error('Error fetching initial subnet node from Neo4j:', error);
        return [];
    } finally {
        await session.close();
    }
}

// From port 3000 server - neighbor node queries for expansion
async function getNeighborNodes(nodeId, nodeType, cidrNotation = '147.251.96.0/24') {
    const session = driver.session();
    const { baseNetwork, fullCIDR } = parseCIDR(cidrNotation);

    try {
        let query = '';

        if (nodeType === 'CIDR_Node') {
            query = `MATCH (o:OrganizationUnit) WHERE id(o) = $nodeId WITH o ` +
                `MATCH (o)-[r]-(s:Subnet) WHERE s.range CONTAINS $baseNetwork ` +
                `AND NOT s.range ENDS WITH $fullCIDR ` +
                `RETURN r, s;`;
        } else if (nodeType === 'Subnet') {
            query = `MATCH (s:Subnet)-[r]-(ip:IP) WHERE id(s) = $nodeId ` +
                `RETURN s, r, ip;`;
        } else if (nodeType === 'IP') {
            query = `MATCH (i:IP)-[r]-(d:DomainName), (i)-[r1]-(n:Node), (n)-[r2]-(h:Host), ` +
                `(h)-[r3]-(sv:SoftwareVersion) WHERE id(i) = $nodeId WITH r, d, r1, n, r2, h, r3, sv ` +
                `LIMIT 1 ` +
                `OPTIONAL MATCH (sv)-[sR1]-(ns:NetworkService) ` +
                `OPTIONAL MATCH (sv)-[sR2]-(v:Vulnerability) ` +
                `OPTIONAL MATCH (v)-[vulnR]-(c:CVE) ` +
                `RETURN r, d, r1, n, r2, h, r3, sv, sR1, ns, sR2, v, vulnR, c ` +
                `LIMIT 1;`;
        }

        if (!query) {
            throw new Error('Cypher query is empty');
        }

        const result = await session.run(query, {
            nodeId: parseInt(nodeId),
            nodeType: nodeType,
            baseNetwork: baseNetwork,
            fullCIDR: fullCIDR
        });

        const elements = [];
        result.records.forEach(record => {
            record.keys.forEach(key => {
                const node = record.get(key);

                if (node) {
                    if (!node.type) {
                        const nodeID = node.identity['low'];
                        const nodeType = node.labels[0];
                        const nodeProperty = node.properties;
                        const { nodeLabel, nodeDetails } = getNodeData(nodeType, nodeProperty);

                        elements.push({
                            data: {
                                id: nodeID,
                                type: nodeType,
                                label: nodeLabel,
                                details: nodeDetails
                            }
                        });

                        virtualNetwork.setNode(nodeID, { label: nodeLabel, type: nodeType, details: nodeDetails });
                    } else {
                        const edgeSource = node.start['low'];
                        const edgeTarget = node.end['low'];
                        const edgeType = node.type;
                        const edgeID = `${edgeSource}-${edgeTarget}`;

                        elements.push({
                            data: {
                                id: edgeID,
                                source: edgeSource,
                                target: edgeTarget,
                                label: edgeType
                            }
                        });

                        virtualNetwork.setEdge(edgeSource, edgeTarget, { id: edgeID, type: edgeType });
                    }
                }
            });
        });

        return elements;
    } catch (error) {
        console.error('Error fetching neighbors from Neo4j:', error);
        return [];
    } finally {
        await session.close();
    }
}

// Helper functions
function getNodeData(nodeType, nodeProperty){
    let nodeLabel, nodeDetails;

    switch (nodeType) {
       case 'Subnet':
        nodeLabel = nodeProperty.range;
        const subnetRiskScore = nodeProperty['Risk Score'] || nodeProperty.riskScore || nodeProperty.risk_score;
        if (subnetRiskScore !== undefined && subnetRiskScore !== null) {
            nodeDetails = subnetRiskScore.toFixed(1);
        } else {
            nodeDetails = nodeProperty.note || 'N/A';
        }
        break;
       case 'IP':
           nodeLabel = nodeProperty.address || 'N/A';
           nodeDetails = null
           break;
       case 'DomainName':
           nodeLabel = nodeProperty.domain_name || 'N/A';
           nodeDetails = nodeProperty.tag || 'N/A';
           break;
       case 'Node':
       const riskScore = nodeProperty['Risk Score'] || nodeProperty.riskScore || nodeProperty.risk_score || 0;
       nodeLabel = riskScore.toFixed(1);
       nodeDetails = (nodeProperty.topology_betweenness || 0).toFixed(1);
       break;
       case 'Host':
           nodeLabel = 'Host';
           nodeDetails = null;
           break;
       case 'SoftwareVersion':
           nodeLabel = nodeProperty.version || 'N/A';
           nodeDetails = nodeProperty.tag || 'N/A';
           break;
       case 'NetworkService':
           nodeLabel = nodeProperty.protocol || 'N/A';
           nodeDetails = nodeProperty.service || 'N/A';
           break;
       case 'Vulnerability':
           nodeLabel = 'Vulnerability';
           nodeDetails = nodeProperty.description || 'N/A';
           break;
       case 'CVE':
           nodeLabel = nodeProperty.impact[0] || 'N/A';
           nodeDetails = (nodeProperty.base_score_v3 || 0).toFixed(1);
           break;
    }

    return { nodeLabel, nodeDetails };
}

function parseCIDR(cidrNotation) {
    const [network, mask] = cidrNotation.split('/');
    const octets = network.split('.');
    const baseNetwork = `${octets[0]}.${octets[1]}.${octets[2]}.`;
    return {
        network: network,
        mask: mask,
        baseNetwork: baseNetwork,
        fullCIDR: cidrNotation
    };
}

// Virtual network management
async function populateVirtualNetwork(data) {
    if (Array.isArray(data)) {
        data.forEach(element => {
            const { id, source, target, label, type, parent, details, hosts, vulns } = element.data;

            if (source !== undefined && target !== undefined) {
                virtualNetwork.setEdge(
                    String(source),
                    String(target),
                    {
                        id: String(id),
                        type: label
                    }
                );
            } else if (id !== undefined && type) {
                const nodeData = { label, type, details, hosts, vulns };
                if (parent) nodeData.parent = parent;
                virtualNetwork.setNode(String(id), nodeData);
            }
        });
    }
}

async function getVirtualNetworkData() {
    try {
        const elements = [];

        virtualNetwork.nodes().forEach(nodeId => {
            const nodeData = {
                id: nodeId,
                label: virtualNetwork.node(nodeId).label,
                type: virtualNetwork.node(nodeId).type,
                details: virtualNetwork.node(nodeId).details,
                hosts: virtualNetwork.node(nodeId).hosts,
                vulns: virtualNetwork.node(nodeId).vulns
            };

            if (virtualNetwork.node(nodeId).parent) {
                nodeData.parent = virtualNetwork.node(nodeId).parent;
            }

            elements.push({ data: nodeData });
        });

        virtualNetwork.edges().forEach(edge => {
            elements.push({
                data: {
                    id: virtualNetwork.edge(edge).id,
                    source: edge.v,
                    target: edge.w,
                    label: virtualNetwork.edge(edge).type,
                }
            });
        });

        return elements;
    } catch (error) {
        console.error('Error sending virtual network data:', error);
        return [];
    }
}

// Cache management
function saveVirtualNetwork() {
    try {
        const serializedGraph = graphlib.json.write(virtualNetwork);
        if (!fs.existsSync(path.dirname(virtualNetworkFilePath))) {
            fs.mkdirSync(path.dirname(virtualNetworkFilePath), { recursive: true });
        }
        fs.writeFileSync(virtualNetworkFilePath, JSON.stringify(serializedGraph, null, 2));
        console.log(`Virtual network saved at ${new Date().toISOString()}`);
    } catch (error) {
        console.error('Error saving virtual network:', error);
    }
}

async function loadVirtualNetwork() {
    try {
        if (fs.existsSync(virtualNetworkFilePath)) {
            const stats = fs.statSync(virtualNetworkFilePath);
            const ageHours = (Date.now() - stats.mtime) / (1000 * 60 * 60);
            
            console.log(`Virtual network cache age: ${ageHours.toFixed(1)} hours`);
            
            if (ageHours > CACHE_MAX_AGE_HOURS) {
                console.log(`Cache is older than ${CACHE_MAX_AGE_HOURS} hours, deleting stale data...`);
                fs.unlinkSync(virtualNetworkFilePath);
                virtualNetwork = new graphlib.Graph();
                console.log('Fetching fresh data from Neo4j...');
                const initialData = await getInitialData();
                await populateVirtualNetwork(initialData);
                saveVirtualNetwork();
            } else {
                const data = fs.readFileSync(virtualNetworkFilePath, 'utf-8');
                if (data) {
                    virtualNetwork = graphlib.json.read(JSON.parse(data));
                    console.log('Fresh virtual network loaded from cache.');
                }
            }
        } else {
            console.log('No virtual network cache found, initializing new network.');
            virtualNetwork = new graphlib.Graph();
        }
    } catch (error) {
        console.error('Error loading virtual network:', error);
        virtualNetwork = new graphlib.Graph();
    }
}

// CIDR Treemap function from port 3001 server
async function buildCIDRTreemap(supernet, cidrDict) {
    const IPCIDR = await import('ip-cidr');
    
    const treemap = {
        [supernet]: {
            cidr: supernet,
            label: 'my_pool',
            children: [],
        },
    };

    const startSuffix = parseInt(supernet.split('/')[1], 10);
    const endSuffix = 31;

    function createSubnets(cidr, suffix) {
        const cidrObj = new IPCIDR.default(cidr);

        if (!cidrObj.address.isCorrect()) {
            throw new Error(`Invalid CIDR: ${cidr}`);
        }

        const subnetMask = parseInt(cidr.split('/')[1], 10);

        if (suffix < subnetMask) {
            throw new Error(`Invalid suffix: ${suffix} cannot be smaller than ${subnetMask}`);
        }

        const subnetList = [];
        const startIP = cidrObj.start();
        const totalSubnets = 2 ** (suffix - subnetMask);

        for (let i = 0; i < totalSubnets; i++) {
            const offsetIP = incrementIP(startIP, i * (2 ** (32 - suffix)));
            subnetList.push(`${offsetIP}/${suffix}`);
        }

        return subnetList;
    }

    function incrementIP(ip, increment) {
        const parts = ip.split('.').map(Number);
        let value = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
        value += increment;

        return [
            (value >>> 24) & 255,
            (value >>> 16) & 255,
            (value >>> 8) & 255,
            value & 255,
        ].join('.');
    }

    function generateNestedSubnets(supernet, startSuffix, endSuffix) {
        const result = [];
        const cidrSuffixes = [];
        let currentSubnets = [supernet];

        for (let suffix = startSuffix; suffix <= endSuffix; suffix++) {
            const nextLevelSubnets = [];
            currentSubnets.forEach((cidr) => {
                const subnets = createSubnets(cidr, suffix);
                nextLevelSubnets.push(...subnets);
            });

            result.push(...nextLevelSubnets);
            let suffixStr = String(suffix);
            cidrSuffixes.push(suffixStr);
            currentSubnets = nextLevelSubnets;
        }

        return { allSubnets: result, cidrSuffixes };
    }

    const { allSubnets, cidrSuffixes } = generateNestedSubnets(supernet, startSuffix, endSuffix);
    const newLabel = 'my_pool';

    allSubnets.forEach(sub => {
        if (!cidrDict.hasOwnProperty(sub)) {
            cidrDict[sub] = {
                value: sub,
                label: newLabel,
            };
        }
    });

    function isInSubnet(child, parent) {
        const parentCidr = new IPCIDR.default(parent);
        const childCidr = new IPCIDR.default(child);
        const parentRange = parentCidr.toRange();
        const childRange = childCidr.toRange();
        const [parentStart, parentEnd] = parentRange.map(ip => ip2long(ip));
        const [childStart, childEnd] = childRange.map(ip => ip2long(ip));
        return childStart >= parentStart && childEnd <= parentEnd;
    }

    function ip2long(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
    }

    function insertIntoTree(node, cidr, label, vuln) {
        let mostSpecificParent = null;

        for (const child of node.children) {
            if (isInSubnet(cidr, child.cidr)) {
                if (
                    !mostSpecificParent ||
                    new IPCIDR.default(child.cidr).prefixLength >
                    new IPCIDR.default(mostSpecificParent.cidr).prefixLength
                ) {
                    mostSpecificParent = child;
                }
            }
        }

        if (mostSpecificParent) {
            insertIntoTree(mostSpecificParent, cidr, label, vuln);
        } else {
            node.children.push({ cidr, label, vuln, children: [] });
        }
    }

    delete cidrDict[supernet];

    const sortedCIDRDictEntries = Object.entries(cidrDict).sort(([keyA], [keyB]) => {
        const getSuffix = (cidr) => parseInt(cidr.split('/')[1], 10);
        const getFourthOctet = (cidr) => parseInt(cidr.split('.')[3].split('/')[0], 10);
        const getThirdOctet = (cidr) => parseInt(cidr.split('.')[2], 10);

        const suffixA = getSuffix(keyA);
        const suffixB = getSuffix(keyB);

        if (suffixA !== suffixB) {
            return suffixA - suffixB;
        }

        const thirdOctetA = getThirdOctet(keyA);
        const thirdOctetB = getThirdOctet(keyB);

        if (thirdOctetA === thirdOctetB) {
            const fourthOctetA = getFourthOctet(keyA);
            const fourthOctetB = getFourthOctet(keyB);
            return fourthOctetA - fourthOctetB;
        }

        return thirdOctetA - thirdOctetB;
    });

    for (const [cidr, { value, label, vuln }] of sortedCIDRDictEntries) {
        if (isInSubnet(value, supernet)) {
            insertIntoTree(treemap[supernet], value, label, vuln);
        }
    }

    const result = {};
    for (const child of treemap[supernet].children) {
        result[child.cidr] = { ...child };
        delete child.cidr;
    }

    return { treemap: result, cidrSuffixes };
}

// Collapse function for virtual network
async function collapseVirtualNetwork(expandedData) {
    expandedData.forEach(element => {
        const { id, source, target, label, type, parent, details } = element.data;

        if (source !== undefined && target !== undefined) {
            if (virtualNetwork.hasEdge(String(source), String(target))) {
                virtualNetwork.removeEdge(String(source), String(target));
            }
        } else if (id !== undefined) {
            if (virtualNetwork.hasNode(String(id))) {
                virtualNetwork.removeNode(String(id));
            }
        }
    });
}

// API Routes - Combined from both servers

// Network data endpoints from port 3001
app.get('/api/fetch-cidr-data', async (req, res) => {
    try {
        const initialData = await getInitialData();
        await populateVirtualNetwork(initialData);
        saveVirtualNetwork();
        res.json({ message: 'Initial CIDR range fetched and virtual network saved.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch initial CIDR data.' });
    }
});

app.get('/api/get-virtual-network-data', async (req, res) => {
    try {
        const data = await getVirtualNetworkData();
        res.json(data);
    } catch (error) {
        console.error('Error fetching virtual network data:', error);
        res.status(500).json({ error: 'Failed to fetch virtual network data' });
    }
});

app.post('/api/build-cidr-treemap', async (req, res) => {
    const { supernet, cidrDict } = req.body;
    try {
        const { treemap, cidrSuffixes } = await buildCIDRTreemap(supernet, cidrDict);
        res.json({ treemap, cidrSuffixes });
    } catch (error) {
        console.error('Error building CIDR treemap:', error);
        res.status(500).json({ error: 'Failed to build CIDR treemap.' });
    }
});

// Detailed network endpoints from port 3000
app.get('/api/fetch-subnet-data', async (req, res) => {
    const { netRange } = req.query;
    if (!netRange) {
        return res.status(400).json({ error: 'netRange is required' });
    }
    try {
        const data = await getInitialSubnetNode(netRange);
        await populateVirtualNetwork(data);
        saveVirtualNetwork();
        res.status(200).json({ message: 'Subnet data fetched', data });
    } catch (error) {
        console.error('Error fetching subnet data:', error);
        res.status(500).json({ error: 'Failed to fetch subnet data' });
    }
});

app.post('/api/expand-virtual-network/:nodeId/:nodeType', async (req, res) => {
    try {
        const { nodeId, nodeType } = req.params;
        const { cidrNotation = '147.251.96.0/24' } = req.body;
        
        console.log(`Expanding node ${nodeId} of type ${nodeType} for network ${cidrNotation}`);
        
        const expandedData = await getNeighborNodes(nodeId, nodeType, cidrNotation);
        
        if (nodeType === 'IP'){
            const compoundId = `compound-${nodeId}`;
            const vulnerabilityCompoundId = `vulnerability-compound-${nodeId}`;
            let hasVulnerabilityData = false;

            expandedData.forEach(element => {
                const { type } = element.data;
                if (type === 'Vulnerability' || type === 'NetworkService' || type === 'CVE') {
                    hasVulnerabilityData = true;
                }
            });

            expandedData.forEach(element => {
                const { type, id, source } = element.data;
                if (id === nodeId || type === 'IP' || source !== undefined) return;

                if (hasVulnerabilityData && (type === 'Vulnerability' || type === 'NetworkService'
                    || type === 'CVE' || type === 'SoftwareVersion')) {
                    element.data.parent = vulnerabilityCompoundId;
                } else {
                    element.data.parent = compoundId;
                }
            });

            if (hasVulnerabilityData) {
                expandedData.push({
                    data: {
                        id: vulnerabilityCompoundId,
                        type: 'Compound',
                        label: `Vulnerability Compound for ${nodeId}`,
                        details: null,
                        parent: compoundId
                    }
                });
            }

            expandedData.push({
                data: {
                    id: compoundId,
                    type: "Compound",
                    details: null,
                    label: `Compound Node for ${nodeId}`
                }
            });
        }

        await populateVirtualNetwork(expandedData);
        await saveVirtualNetwork();
        
        const updatedElements = await getVirtualNetworkData();
        
        res.json({
            message: 'Virtual network expanded successfully',
            nodeId: nodeId,
            nodeType: nodeType,
            cidrNotation: cidrNotation,
            elements: updatedElements,
            totalNodes: virtualNetwork.nodeCount(),
            totalEdges: virtualNetwork.edgeCount()
        });
    } catch (error) {
        console.error('Error expanding virtual network:', error);
        res.status(500).json({ error: 'Failed to expand virtual network' });
    }
});

app.get('/api/expand-virtual-network/:nodeId/:nodeType', async (req, res) => {
    try {
        const nodeId = req.params.nodeId;
        const nodeType = req.params.nodeType;
        
        const expandedData = await getNeighborNodes(nodeId, nodeType);
        
        if (nodeType === 'IP'){
            const compoundId = `compound-${nodeId}`;
            const vulnerabilityCompoundId = `vulnerability-compound-${nodeId}`;
            let hasVulnerabilityData = false;

            expandedData.forEach(element => {
                const { type } = element.data;
                if (type === 'Vulnerability' || type === 'NetworkService' || type === 'CVE') {
                    hasVulnerabilityData = true;
                }
            });

            expandedData.forEach(element => {
                const { type, id, source } = element.data;
                if (id === nodeId || type === 'IP' || source !== undefined) return;

                if (hasVulnerabilityData && (type === 'Vulnerability' || type === 'NetworkService'
                    || type === 'CVE' || type === 'SoftwareVersion')) {
                    element.data.parent = vulnerabilityCompoundId;
                } else {
                    element.data.parent = compoundId;
                }
            });

            if (hasVulnerabilityData) {
                expandedData.push({
                    data: {
                        id: vulnerabilityCompoundId,
                        type: 'Compound',
                        label: `Vulnerability Compound for ${nodeId}`,
                        details: null,
                        parent: compoundId
                    }
                });
            }

            expandedData.push({
                data: {
                    id: compoundId,
                    type: "Compound",
                    details: null,
                    label: `Compound Node for ${nodeId}`
                }
            });
        }

        await populateVirtualNetwork(expandedData);
        await saveVirtualNetwork();
        res.json({ message: `Neighbor data for ${nodeId} fetched and virtual network saved.` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch neighbor data.' });
    }
});

app.post('/api/collapse-virtual-network', async (req, res) => {
    try {
        const data = req.body;
        console.log(`Collapsing ${data.length} elements from virtual network`);
        
        await collapseVirtualNetwork(data);
        await saveVirtualNetwork();
        
        console.log('Virtual network collapsed and saved');
        
        res.json({ 
            message: 'Virtual network collapsed and saved successfully',
            elementsRemoved: data.length,
            remainingNodes: virtualNetwork.nodeCount(),
            remainingEdges: virtualNetwork.edgeCount()
        });
    } catch (error) {
        console.error('Error collapsing virtual network:', error);
        res.status(500).json({ error: 'Failed to collapse virtual network' });
    }
});

// Debug endpoints from port 3000
app.get('/api/debug-node-properties', async (req, res) => {
    const session = driver.session();
    
    try {
        const query = `
        MATCH (n:Node)
        RETURN n
        LIMIT 10
        `;
        
        const result = await session.run(query);
        const nodeProperties = [];
        
        result.records.forEach((record, index) => {
            const node = record.get('n');
            const props = node.properties;
            nodeProperties.push({
                nodeIndex: index,
                nodeId: node.identity.toNumber(),
                properties: Object.keys(props),
                propertyValues: props
            });
        });

        const allKeysQuery = `
        MATCH (n:Node)
        WITH n
        UNWIND keys(n) as key
        RETURN DISTINCT key, count(*) as nodeCount
        ORDER BY nodeCount DESC
        `;
        
        const allKeysResult = await session.run(allKeysQuery);
        const allUniqueKeys = allKeysResult.records.map(record => ({
            property: record.get('key'),
            nodeCount: record.get('nodeCount').toNumber()
        }));

        res.json({
            sampleNodes: nodeProperties,
            allUniqueProperties: allUniqueKeys,
            totalSampleNodes: nodeProperties.length
        });

    } catch (error) {
        console.error('Error in debug endpoint:', error);
        res.status(500).json({ error: 'Failed to debug node properties', details: error.message });
    } finally {
        await session.close();
    }
});

app.get('/api/debug-ip-targeting', async (req, res) => {
    const session = driver.session();
    
    try {
        const query = `
        MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
        WHERE n.\`Risk Score\` IS NOT NULL
        RETURN ip.address as ipAddress, subnet.range as subnetRange, n.\`Risk Score\` as riskScore
        LIMIT 10
        `;
        
        const result = await session.run(query);
        const ips = result.records.map(record => ({
            ip: record.get('ipAddress'),
            subnet: record.get('subnetRange'),
            riskScore: record.get('riskScore')
        }));

        res.json({
            message: 'Sample IPs with Node connections',
            ips: ips,
            count: ips.length
        });

    } catch (error) {
        console.error('Error in IP debug endpoint:', error);
        res.status(500).json({ error: 'Failed to get IP debug info', details: error.message });
    } finally {
        await session.close();
    }
});

// Node attributes endpoint from port 3000
app.get('/api/get-node-attributes', async (req, res) => {
    const session = driver.session();
    
    try {
        console.log('Fetching node attributes...');
        
        const allKeysQuery = `
        MATCH (n:Node)
        WITH n
        UNWIND keys(n) as key
        RETURN DISTINCT key, count(*) as nodeCount
        ORDER BY nodeCount DESC
        `;
        
        const allKeysResult = await session.run(allKeysQuery);
        console.log(`Found ${allKeysResult.records.length} unique properties on Node objects`);
        
        const allProperties = {};
        const knownSystemProperties = [
            'id', 'created', 'updated', 'name', 'label', 'type', 'status'
        ];
        
        for (const record of allKeysResult.records) {
            const propKey = record.get('key');
            const nodeCount = record.get('nodeCount').toNumber();
            
            console.log(`Processing property: ${propKey} (${nodeCount} nodes)`);
            
            if (knownSystemProperties.includes(propKey)) {
                console.log(`Skipping system property: ${propKey}`);
                continue;
            }
            
            try {
                const statsQuery = `
                MATCH (n:Node)
                WHERE n.${propKey.includes(' ') ? '`' + propKey + '`' : propKey} IS NOT NULL
                AND toString(n.${propKey.includes(' ') ? '`' + propKey + '`' : propKey}) =~ '^-?[0-9]*\\.?[0-9]+$'
                WITH toFloat(n.${propKey.includes(' ') ? '`' + propKey + '`' : propKey}) as numValue
                WHERE numValue IS NOT NULL
                RETURN 
                    avg(numValue) as avgValue,
                    max(numValue) as maxValue,
                    min(numValue) as minValue,
                    count(numValue) as numericCount
                `;
                
                const statsResult = await session.run(statsQuery);
                
                if (statsResult.records.length > 0) {
                    const statsRecord = statsResult.records[0];
                    const numericCount = statsRecord.get('numericCount').toNumber();
                    
                    if (numericCount > 0) {
                        allProperties[propKey] = {
                            avg: statsRecord.get('avgValue'),
                            max: statsRecord.get('maxValue'),
                            min: statsRecord.get('minValue'),
                            nodeCount: numericCount,
                            totalNodes: nodeCount
                        };
                        console.log(`✅ ${propKey}: avg=${allProperties[propKey].avg?.toFixed(2)}, max=${allProperties[propKey].max?.toFixed(2)}, nodes=${numericCount}`);
                    }
                }
            } catch (propError) {
                console.log(`⚠️ Could not get stats for ${propKey}:`, propError.message);
            }
        }
        
        console.log(`Successfully processed ${Object.keys(allProperties).length} numeric properties`);
        
        const response = {
            statistics: {},
            discoveredProperties: allProperties,
            totalPropertiesFound: Object.keys(allProperties).length
        };
        
        const knownMappings = {
            'betweenness': 'betweenness',
            'degree': 'degree', 
            'normalizedBetweenness': 'normalizedBetweenness',
            'normalizedDegree': 'normalizedDegree',
            'cvss_score': 'cvssScore',
            'criticality': 'criticality',
            'threatScore': 'threatScore',
            'Risk Score': 'riskScore'
        };
        
        Object.entries(knownMappings).forEach(([neo4jProp, apiKey]) => {
            if (allProperties[neo4jProp]) {
                response.statistics[apiKey] = allProperties[neo4jProp];
            }
        });
        
        console.log('Sending response with:', response.totalPropertiesFound, 'properties');
        res.json(response);

    } catch (error) {
        console.error('Error fetching node attributes:', error);
        res.status(500).json({ 
            error: 'Failed to fetch node attributes', 
            details: error.message,
            stack: error.stack 
        });
    } finally {
        await session.close();
    }
});

// Custom risk component endpoint from port 3000
app.post('/api/write-custom-risk-component', async (req, res) => {
    const session = driver.session();
    
    try {
        const { 
            componentName, 
            neo4jProperty, 
            formula, 
            method, 
            components, 
            targetType = 'all',
            targetValues = [],
            calculationMode = 'calculate'
        } = req.body;

        console.log(`Updating Neo4j property: ${neo4jProperty}`);
        console.log(`Method: ${method}`);
        console.log(`Target Type: ${targetType}`);
        console.log(`Calculation Mode: ${calculationMode}`);
        console.log('Components received:', components);

        let query = '';
        let whereClause = '';

        const formatPropertyName = (propName) => {
            if (propName.includes(' ') || propName.includes('-')) {
                return `\`${propName}\``;
            }
            return propName;
        };

        if (targetType === 'network' && targetValues.length > 0) {
            const networkPrefixes = targetValues.map(network => `"${network.prefix}."`);
            whereClause = `AND (${networkPrefixes.map(prefix => `ip.address STARTS WITH ${prefix}`).join(' OR ')})`;
        } else if (targetType === 'subnet' && targetValues.length > 0) {
            const subnetRanges = targetValues.map(subnet => `"${subnet.subnet}"`);
            whereClause = `AND subnet.range IN [${subnetRanges.join(', ')}]`;
        } else if (targetType === 'sample' && targetValues.length > 0) {
            const subnetRanges = targetValues.map(subnet => `"${subnet.subnet}"`);
            whereClause = `AND subnet.range IN [${subnetRanges.join(', ')}]`;
        } else if (targetType === 'ip' && targetValues.length > 0) {
            const ipAddresses = targetValues.map(ip => `"${ip.ip}"`);
            whereClause = `AND ip.address IN [${ipAddresses.join(', ')}]`;
        }

        if (calculationMode === 'setValue') {
            const setValue = components[0]?.currentValue || 0;
            
            if (targetType === 'all') {
                query = `
                MATCH (n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL
                SET n.${formatPropertyName(neo4jProperty)} = ${setValue}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            } else {
                query = `
                MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL ${whereClause}
                SET n.${formatPropertyName(neo4jProperty)} = ${setValue}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            }

        } else if (method === 'weighted_avg') {
            const weightedTerms = components.map(comp => {
                const value = comp.currentValue || 0;
                return `${value} * ${comp.weight}`;
            }).join(' + ');
            
            const totalWeights = components.reduce((sum, comp) => sum + comp.weight, 0);
            
            if (targetType === 'all') {
                query = `
                MATCH (n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL
                SET n.${formatPropertyName(neo4jProperty)} = (${weightedTerms}) / ${totalWeights}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            } else {
                query = `
                MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL ${whereClause}
                SET n.${formatPropertyName(neo4jProperty)} = (${weightedTerms}) / ${totalWeights}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            }

        } else if (method === 'max') {
            const maxTerms = components.map(comp => comp.currentValue || 0).join(', ');
            
            if (targetType === 'all') {
                query = `
                MATCH (n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL
                SET n.${formatPropertyName(neo4jProperty)} = apoc.coll.max([${maxTerms}])
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            } else {
                query = `
                MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL ${whereClause}
                SET n.${formatPropertyName(neo4jProperty)} = apoc.coll.max([${maxTerms}])
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            }

        } else if (method === 'sum') {
            const sumTerms = components.map(comp => comp.currentValue || 0).join(' + ');
            
            if (targetType === 'all') {
                query = `
                MATCH (n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL
                SET n.${formatPropertyName(neo4jProperty)} = ${sumTerms}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            } else {
                query = `
                MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL ${whereClause}
                SET n.${formatPropertyName(neo4jProperty)} = ${sumTerms}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            }

        } else if (method === 'geometric_mean') {
            const safeComponents = components.map(comp => {
                const value = comp.currentValue || 0;
                return `CASE WHEN ${value} <= 0 THEN 0.1 ELSE ${value} END`;
            });
            const geometricFormula = `(${safeComponents.join(' * ')}) ^ (1.0/${components.length})`;
            
            if (targetType === 'all') {
                query = `
                MATCH (n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL
                SET n.${formatPropertyName(neo4jProperty)} = ${geometricFormula}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            } else {
                query = `
                MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL ${whereClause}
                SET n.${formatPropertyName(neo4jProperty)} = ${geometricFormula}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            }
        } else if (method === 'custom_formula') {
            let formulaExpression = formula;
            
            components.forEach(comp => {
                const value = comp.currentValue || 0;
                const regex = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                formulaExpression = formulaExpression.replace(regex, value.toString());
            });
            
            if (targetType === 'all') {
                query = `
                MATCH (n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL
                SET n.${formatPropertyName(neo4jProperty)} = ${formulaExpression}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            } else {
                query = `
                MATCH (subnet:Subnet)<-[:PART_OF]-(ip:IP)<-[:HAS_ASSIGNED]-(n:Node)
                WHERE n.\`Risk Score\` IS NOT NULL ${whereClause}
                SET n.${formatPropertyName(neo4jProperty)} = ${formulaExpression}
                RETURN count(n) as updatedNodes, avg(n.${formatPropertyName(neo4jProperty)}) as avgValue
                `;
            }

        } else {
            throw new Error(`Unsupported method: ${method}`);
        }

        console.log('Executing Node query:', query);
        const result = await session.run(query);
        const record = result.records[0];
        const updatedNodes = record.get('updatedNodes').toNumber();
        const avgValue = record.get('avgValue');

        console.log(`Successfully updated ${updatedNodes} Node objects`);

        res.json({
            success: true,
            message: `Property '${neo4jProperty}' updated on Node objects`,
            results: {
                updatedNodes,
                avgValue: parseFloat(avgValue?.toFixed(2) || '0'),
                neo4jProperty,
                method,
                componentCount: components.length,
                targetType,
                targetCount: targetValues.length,
                calculationMode
            }
        });

    } catch (error) {
        console.error('Error updating Node property:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update Node property',
            details: error.message 
        });
    } finally {
        await session.close();
    }
});

// Cache management endpoints
app.post('/api/refresh-cache', async (req, res) => {
    try {
        console.log('Manual cache refresh requested...');
        
        if (fs.existsSync(virtualNetworkFilePath)) {
            fs.unlinkSync(virtualNetworkFilePath);
        }
        
        virtualNetwork = new graphlib.Graph();
        const initialData = await getInitialData();
        await populateVirtualNetwork(initialData);
        saveVirtualNetwork();
        
        res.json({ 
            message: 'Cache refreshed successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error refreshing cache:', error);
        res.status(500).json({ error: 'Failed to refresh cache' });
    }
});

app.get('/api/cache-status', (req, res) => {
    try {
        if (fs.existsSync(virtualNetworkFilePath)) {
            const stats = fs.statSync(virtualNetworkFilePath);
            const ageHours = (Date.now() - stats.mtime) / (1000 * 60 * 60);
            
            res.json({
                exists: true,
                created: stats.mtime,
                createdFormatted: new Date(stats.mtime).toISOString(),
                ageHours: parseFloat(ageHours.toFixed(2)),
                isStale: ageHours > CACHE_MAX_AGE_HOURS,
                maxAgeHours: CACHE_MAX_AGE_HOURS,
                nodeCount: virtualNetwork.nodeCount(),
                edgeCount: virtualNetwork.edgeCount()
            });
        } else {
            res.json({
                exists: false,
                nodeCount: virtualNetwork.nodeCount(),
                edgeCount: virtualNetwork.edgeCount()
            });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to check cache status' });
    }
});

// Start server
app.listen(port, async () => {
    console.log(`Merged server listening at http://localhost:${port}`);
    await loadVirtualNetwork();
});

// Shutdown handlers
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    console.log('Preserving network cache for next startup.');
    
    virtualNetwork = new graphlib.Graph();
    
    driver.close();
    process.exit();
});

process.on('exit', () => {
    console.log('Exited');
    driver.close();
});