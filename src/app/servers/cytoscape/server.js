//CytoScape
const express = require('express');
const path = require('path');
const neo4j = require('neo4j-driver');
const cors = require('cors');
require('dotenv').config();
const graphlib = require('graphlib');
const fs = require('fs');

// Initialize virtual network
let virtualNetwork = new graphlib.Graph();
const virtualNetworkFilePath = path.join(__dirname, 'data', 'virtualNetwork.json');

// define a CIDR prefix
const cidrPrefix = '147.251.96.';
const cidrPostfix = '0/24';

// Neo4j credentials from environment variables
const uri = process.env.NEO4J_SERVER_URL || 'bolt://localhost:7687';
const user = process.env.NEO4J_USERNAME || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'myNeo4jPassword';
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));

// Initialize Express.js
const app = express();
const port = 3000; // Port to run the web server

app.use(express.static(path.join(__dirname, '../resilmesh-dashboard/src/assets')));
app.use(express.json());

app.use(cors({
    origin: '*', // Allow only your Angular app
    methods: 'GET,POST',
    allowedHeaders: 'Content-Type,Authorization'
}));

// initial data from Neo4j database
async function getInitialCIDRNode(cidrNotation = '147.251.96.0/24', orgUnit = 'FF') {
    const session = driver.session();
    const { fullCIDR } = parseCIDR(cidrNotation);

    try {
        const query = `MATCH (o:OrganizationUnit) WHERE o.name in ["${orgUnit}"] WITH o ` +
            `MATCH (o)-[r]-(s:Subnet) WHERE s.range IN ["${fullCIDR}"] ` +
            `RETURN o, r, s;`;

        const result = await session.run(query);
        // ... rest of the function remains the same
    } catch (error) {
        console.error('Error fetching initial CIDR notation from Neo4j:', error);
        return [];
    } finally {
        await session.close();
    }
}

//   Neo4j Queries   //
async function getInitialSubnetNode(netRange){
    const session = driver.session();

    try {

	// define initial Neo4j query
	let query = `MATCH (s:Subnet) WHERE s.range IN ["${netRange}"] RETURN s;`;

	// Run a query to fetch node
	const result = await session.run(query);

	const elements = [];

	let nodeId = null;
	let nodeType = 'Subnet';
	let nodeDetails = null;
	let nodeLabel = null;

	// Process the Subnet result and convert the responding nodes to Cytoscape elements
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
	console.error('Error fetching initial CIDR notation from Neo4j:', error);
	return [];
    } finally {
	await session.close();
    }
}

async function getNeighborNodes(nodeId, nodeType, cidrNotation = '147.251.96.0/24') {
    const session = driver.session();
    
    // Parse CIDR notation for dynamic network handling
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

        // Ensure the query is not empty
        if (!query) {
            throw new Error('Cypher query is empty');
        }

        // Pass parameters including dynamic network values
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

                // Check if the node is not null
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

                        // Add the node to the virtual network
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

                        // Add the edge between the source and target to the virtual network
                        virtualNetwork.setEdge(edgeSource, edgeTarget, { id: edgeID, type: edgeType });
                    }
                } else {
                    return;
                }
            });
        });

        return elements;
    } catch (error) {
        console.error('Error fetching neighbors from Neo4j:', error);
    } finally {
        await session.close();
    }
}

//   helper functions   //

// define a function to get the label of a node
function getNodeData(nodeType, nodeProperty){
    //let nodeDetails = '';

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

// Fetch and populate Supernet data
async function fetchAndPopulateCIDR() {
    const initialSupernet = await getInitialCIDRNode(); // Define this as per Neo4j query
    await populateVirtualNetwork(initialSupernet); // Define populate logic
    saveVirtualNetwork();
    console.log('Initial CIDR fetched and virtual network populated.');
}

// Fetch and populate Subnet data
async function fetchAndPopulateSubnet(netRange) {
    const initialSubnet = await getInitialSubnetNode(netRange); // Define this as per Neo4j query
    await populateVirtualNetwork(initialSubnet); // Define populate logic
    saveVirtualNetwork();
    console.log('Initial data fetched and virtual network populated.');
}

async function populateVirtualNetwork(data) {

    // Check if data is an array
    if (Array.isArray(data)) {
        // Populate the virtualNetwork with the data
        data.forEach(element => {
            const { id, source, target, label, type, parent, details } = element.data;

            // Check if the element is an edge
            if (source !== undefined && target !== undefined) {
                virtualNetwork.setEdge(
                    String(source),
                    String(target),
                    {
                        id: String(id),
                        type: label // This is the relationship type
                    }
                );
            } else if (id !== undefined && type) {
                // Check if element is a node
		const nodeData = { label, type, details };

		// Assign compound parent if available
		if (parent) nodeData.parent = parent;

		virtualNetwork.setNode(String(id), nodeData);
            } else {
		console.error('Element is neither a node nor a valid edge:', element);
		return;
            }
        });

    } else {
        console.error('Data is not an array. Cannot populate virtual network.');
    }
}

async function populateExpandedData(nodeId, nodeType) {
    const expandedData = await getNeighborNodes(nodeId, nodeType);

    // if the expanded node is an IP, define compound node for software and existing vulnerabilities
    if (nodeType === 'IP'){
        const compoundId = `compound-${nodeId}`;
        const vulnerabilityCompoundId = `vulnerability-compound-${nodeId}`;

        // Track presence of specific types
        let hasVulnerabilityData = false;

        // First pass to detect if there is any vulnerability-related data
        expandedData.forEach(element => {
	    const { type } = element.data;
	    if (type === 'Vulnerability' || type === 'NetworkService' || type === 'CVE') {
	        hasVulnerabilityData = true;
	    }
        });

        // Second pass to assign parent attributes based on the presence of vulnerability data
        expandedData.forEach(element => {
	    const { type, id, source } = element.data;

	    // Skip setting a parent for the main node or edges
	    if (id === nodeId || type === 'IP' || source !== undefined) return;

	    // Assign parent based on type and presence of vulnerability data
	    if (hasVulnerabilityData && (type === 'Vulnerability' || type === 'NetworkService'
	    	|| type === 'CVE' || type === 'SoftwareVersion')) {
	        element.data.parent = vulnerabilityCompoundId;
	    } else {
	        // If there's no vulnerability data or node is not vulnerability-related
	        element.data.parent = compoundId;
	    }
        });

        // Add nested vulnerability compound node if vulnerability data exists
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

        // Add main compound node to expanded data
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
}

async function collapseVirtualNetwork(expandedData) {

    expandedData.forEach(element => {
        const { id, source, target, label, type, parent, details } = element.data;

        if (source !== undefined && target !== undefined) {

            // Remove edge if it exists
            if (virtualNetwork.hasEdge(String(source), String(target))) {
                virtualNetwork.removeEdge(String(source), String(target));
                // console.log(`Removed edge: ${id}`);
            }
        } else if (id !== undefined) {
            // Remove node if it exists
            if (virtualNetwork.hasNode(String(id))) {
                virtualNetwork.removeNode(String(id));
                // console.log(`Removed node: ${id}`);
            }
        }
    });
}

// function to get virtual network data
async function getVirtualNetworkData() {
    try {
	const elements = [];

        // Add nodes with conditional parent assignment
        virtualNetwork.nodes().forEach(nodeId => {
            const nodeData = {
                id: nodeId,
                label: virtualNetwork.node(nodeId).label,
                type: virtualNetwork.node(nodeId).type,
		details: virtualNetwork.node(nodeId).details
            };

            // Only add 'parent' if it exists for this node
            if (virtualNetwork.node(nodeId).parent) {
                nodeData.parent = virtualNetwork.node(nodeId).parent;
            }

            elements.push({ data: nodeData });
        });

        // Add edges to the elements array
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
        res.status(500).json({ error: 'Failed to fetch virtual network data' });
    }
}

// Save the virtual network to a file
function saveVirtualNetwork() {
    try {
        const serializedGraph = graphlib.json.write(virtualNetwork);
        if (!fs.existsSync(path.dirname(virtualNetworkFilePath))) {
            fs.mkdirSync(path.dirname(virtualNetworkFilePath), { recursive: true });
        }
        fs.writeFileSync(virtualNetworkFilePath, JSON.stringify(serializedGraph, null, 2));
        console.log('Virtual network saved to:', virtualNetworkFilePath);
    } catch (error) {
        console.error('Error saving virtual network:', error);
    }
}

// Configuration - adjust age threshold as needed
const CACHE_MAX_AGE_HOURS = 24; // Delete cache older than 24 hours

// Enhanced load function with timestamp validation
async function loadVirtualNetwork() {
    try {
        if (fs.existsSync(virtualNetworkFilePath)) {
            const stats = fs.statSync(virtualNetworkFilePath);
            const ageHours = (Date.now() - stats.mtime) / (1000 * 60 * 60);
            
            console.log(`Virtual network cache age: ${ageHours.toFixed(1)} hours`);
            
            // Check if cache is too old
            if (ageHours > CACHE_MAX_AGE_HOURS) {
                console.log(`Cache is older than ${CACHE_MAX_AGE_HOURS} hours, deleting stale data...`);
                fs.unlinkSync(virtualNetworkFilePath);
                virtualNetwork = new graphlib.Graph();
                
                // For Cytoscape server, we don't auto-fetch since it's more interactive
                console.log('Stale cache deleted. Use /api/fetch-cidr-data to populate fresh data.');
                return;
            }
            
            // Cache is fresh, load it
            const data = fs.readFileSync(virtualNetworkFilePath, 'utf-8');
            if (data) {
                virtualNetwork = graphlib.json.read(JSON.parse(data));
                console.log('Fresh virtual network loaded from cache.');
            } else {
                console.log('Virtual network file is empty, initializing new network.');
                virtualNetwork = new graphlib.Graph();
            }
        } else {
            console.log('No virtual network cache found, initializing new network.');
            virtualNetwork = new graphlib.Graph();
        }
    } catch (error) {
        console.error('Error loading virtual network:', error);
        // Fallback to empty network if loading fails
        virtualNetwork = new graphlib.Graph();
    }
}

// Enhanced save function with timestamp logging
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

// Updated shutdown handler - preserve cache
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    console.log('Preserving network cache for next startup.');
    
    // Clear the virtual network data in memory only
    virtualNetwork = new graphlib.Graph();
    
    // Close Neo4j driver
    driver.close();
    process.exit();
});

// Optional: Add API endpoint to manually refresh cache
app.post('/api/refresh-cache', async (req, res) => {
    try {
        console.log('Manual cache refresh requested...');
        
        // Delete existing cache
        if (fs.existsSync(virtualNetworkFilePath)) {
            fs.unlinkSync(virtualNetworkFilePath);
        }
        
        // Reinitialize 
        virtualNetwork = new graphlib.Graph();
        
        res.json({ 
            message: 'Cache cleared successfully. Use fetch endpoints to populate fresh data.',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error refreshing cache:', error);
        res.status(500).json({ error: 'Failed to refresh cache' });
    }
});

// Optional: Add API endpoint to check cache status  
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

//  API calls  //
// Export the function for use in the API route
module.exports = {
    getInitialCIDRNode,
    getInitialSubnetNode,
    getNeighborNodes,
    getVirtualNetworkData
};

// API to fetch CIDR data and populate the network
// Replace the existing /api/fetch-cidr-data endpoint
app.get('/api/fetch-cidr-data', async (req, res) => {
    try {
        const { cidrNotation = '147.251.96.0/24', orgUnit = 'FF' } = req.query;
        const data = await fetchAndPopulateCIDR(cidrNotation, orgUnit);
        res.status(200).json({ message: 'CIDR data fetched', data });
    } catch (error) {
        console.error('Error fetching CIDR data:', error);
        res.status(500).json({ error: 'Failed to fetch CIDR data' });
    }
});

// Update the expand endpoint to accept CIDR parameter
app.post('/api/expand-virtual-network/:nodeId/:nodeType', async (req, res) => {
    try {
        const { nodeId, nodeType } = req.params;
        const { cidrNotation = '147.251.96.0/24' } = req.body;
        
        console.log(`Expanding node ${nodeId} of type ${nodeType} for network ${cidrNotation}`);
        
        await populateExpandedData(nodeId, nodeType, cidrNotation);
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

// API to fetch Subnet data and populate the network
app.get('/api/fetch-subnet-data', async (req, res) => {
    const { netRange } = req.query;
    if (!netRange) {
        return res.status(400).json({ error: 'netRange is required' });
    }
    try {
        const data = await fetchAndPopulateSubnet(netRange);
	// res.status(200).json(data);
        res.status(200).json({ message: 'Subnet data fetched', data });
    } catch (error) {
        console.error('Error fetching CIDR data:', error);
        res.status(500).json({ error: 'Failed to fetch CIDR data' });
    }
});

// API to get virtual network data
app.get('/api/get-virtual-network-data', async (req, res) => {
    try {
        const elements = await getVirtualNetworkData();
	res.json(elements);
        // res.status(200).json(elements);
    } catch (error) {
        console.error('Error fetching virtual network data:', error);
        res.status(500).json({ error: 'Failed to fetch virtual network data' });
    }
});

// API route to expand a node and get its neighbors dynamically
app.get('/api/expand-virtual-network/:nodeId/:nodeType', async (req, res) => {
    try {
	const nodeId = req.params.nodeId;
	const nodeType = req.params.nodeType;
        await populateExpandedData(nodeId, nodeType);
	await saveVirtualNetwork();
	res.json({ message: `Neighbor data for ${nodeId} fetched and virtual network saved.` });
    } catch (error) {
	res.status(500).json({ error: 'Failed to fetch neighbor data.' });
    }
});

// API route to collapse a node and remove neighbors
app.post('/api/collapse-virtual-network', async (req, res) => {
    try {
        const data = req.body;
        console.log(`Collapsing ${data.length} elements from virtual network`);
        
        await collapseVirtualNetwork(data);
        
        // IMPORTANT: Save the cleaned network
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

// Debug endpoint to see all properties on Node objects
app.get('/api/debug-node-properties', async (req, res) => {
    const session = driver.session();
    
    try {
        // Get all properties from the first 10 nodes
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

        // Also get all unique property keys across all nodes
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

// Add this endpoint to test IP targeting
app.get('/api/debug-ip-targeting', async (req, res) => {
    const session = driver.session();
    
    try {
        // Get sample IPs that exist in the database
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

// Node attributes endpoint
app.get('/api/get-node-attributes', async (req, res) => {
    const session = driver.session();
    
    try {
        console.log('Fetching node attributes...');
        
        // First, get all unique property keys that exist on Node objects
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
        
        // Get statistics for each numeric property
        for (const record of allKeysResult.records) {
            const propKey = record.get('key');
            const nodeCount = record.get('nodeCount').toNumber();
            
            console.log(`Processing property: ${propKey} (${nodeCount} nodes)`);
            
            // Skip obvious system properties
            if (knownSystemProperties.includes(propKey)) {
                console.log(`Skipping system property: ${propKey}`);
                continue;
            }
            
            try {
                // Try to get numeric statistics for this property
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
        
        // Build the response
        const response = {
            statistics: {},
            discoveredProperties: allProperties,
            totalPropertiesFound: Object.keys(allProperties).length
        };
        
        // Map known properties to the statistics object for backward compatibility
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

// Custom risk component endpoint
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
            calculationMode = 'calculate' // New parameter: 'calculate' or 'setValue'
        } = req.body;

        console.log(`Updating Neo4j property: ${neo4jProperty}`);
        console.log(`Method: ${method}`);
        console.log(`Target Type: ${targetType}`);
        console.log(`Calculation Mode: ${calculationMode}`);
        console.log('Components received:', components);

        let query = '';
        let whereClause = '';

        // Properly format property name for Neo4j (handle spaces)
        const formatPropertyName = (propName) => {
            if (propName.includes(' ') || propName.includes('-')) {
                return `\`${propName}\``;
            }
            return propName;
        };

        // Build target-specific WHERE clause
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
            // Simple value setting mode
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
                const propName = formatPropertyName(comp.neo4jProperty);
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
    // Add geometric mean calculation support
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

// Start the server and load virtual network
app.listen(port, async () => {
    console.log(`App listening at http://localhost:${port}`);
    await loadVirtualNetwork();
});

// Close the Neo4j driver when the process exits
process.on('exit', () => {
    console.log('Exited');
    driver.close();
});