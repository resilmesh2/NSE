import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { NetworkDataService } from '../../services/network-data.service';
import { RiskComponentsService, RiskComponent } from '../../services/risk-components.service';
import { HttpClient } from '@angular/common/http';
import { RiskConfigService, RiskFormula, RiskConfigurationRequest, ConfigurationResponse, ComponentData  } from '../../services/risk-config.service';

interface CalculationMethod {
  id: string;
  name: string;
  type: string;
  icon: string;
  description: string;
}

interface ActiveAutomation {
  id: string;
  componentName?: string;
  componentId?: string;
  updateFrequency?: string;
  update_frequency?: string;
  enabled?: boolean;
  lastRun?: string;
  last_run?: string; 
  createdAt?: string;
  created_date?: string; 
  expiresAt?: string;
  dataSource?: {
    type: string;
    query?: string;
  };
  calculationMethod?: string;
  calculation_method?: string;
  
  avg_risk_score?: number;
  calculation_mode?: string;
  components?: Array<{
    currentValue: number;
    maxValue: number;
    name: string;
    neo4jProperty: string;
    weight: number;
  }>;
  custom_formula?: string;
  formula_config?: { [key: string]: number };
  formula_name?: string;
  nodes_updated?: number;
  target_property?: string;
  target_type?: string;
  target_values?: string[];
  targetType?: string;
  targetValues?: string[];
}

interface NetworkDevice {
  ip: string;
  hostname?: string;
  riskScore?: number;
  isActive?: boolean;
  selected?: boolean;
  hidden?: boolean;
  isMatch?: boolean;
  deviceType?: string;
  os?: string;
  vulnerabilities?: number;
  [key: string]: any; // Allow additional properties
}

interface SubnetData {
  subnet: string;
  deviceCount: number;
  riskScore?: number;
  devices?: NetworkDevice[];
  visibleDevices?: NetworkDevice[];
  expanded?: boolean;
  selected?: boolean;
  hidden?: boolean;
  isMatch?: boolean;
  hasDetailedData?: boolean;
  [key: string]: any; // Allow additional properties
}

interface NetworkData {
  prefix: string;
  subnets: SubnetData[];
  totalDevices: number;
  expanded?: boolean;
  selected?: boolean;
  hidden?: boolean;
  isMatch?: boolean;
  [key: string]: any; // Allow additional properties
}

@Component({
  selector: 'app-drag-drop-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './drag-drop-designer.component.html',
  styleUrls: ['./drag-drop-designer.component.css']
})
export class DragDropDesignerComponent implements OnInit {
  // Risk calculation components
  availableComponents: RiskComponent[] = [];
  riskFormula: RiskComponent[] = [];
  isLoadingComponents = true;

  // Hierarchical network selection properties
  hierarchicalNetworks: NetworkData[] = [];
  networkSearchTerm: string = '';
  networkSearchFilter: string = 'all';
  networkSearchResults: any[] = [];
  showIpModal = false;
  
  // Subnet search
  subnetSearchTerm: string = '';
  filteredSubnets: any[] = [];
  availableSubnets: any[] = [];

  showingAutomations = false;
  activeAutomations: ActiveAutomation[] = [];
  isLoadingAutomations = false;
  automationFilter = 'all';

  predefinedFormulas: RiskFormula[] = [];
  customFormulas: RiskFormula[] = [];
  customComponents: any[] = [];
  activeFormula: RiskFormula | null = null;
  showFormulaSelector = false;
  isLoadingFormulas = false;
  showingFormulas = true;
  toggleButtonText = 'Switch to Components';

  showConfirmModal = false;
  showAlertModal = false;
  confirmModalData: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  thirdButtonText?: string;
  onThirdButton?: () => void;
} = {
  title: '',
  message: '',
  confirmText: 'OK',
  cancelText: 'Cancel',
  onConfirm: () => {},
  onCancel: () => {}
};
  alertModalData = {
    title: '',
    message: '',
    buttonText: 'OK',
    onClose: () => {}
  };

  showFormulaInputModal: boolean = false;
formulaInputModalData: {
  title: string;
  nameLabel: string;
  descriptionLabel: string;
  name: string;
  description: string;
  onSave?: () => void;
  onCancel?: () => void;
} = {
  title: '',
  nameLabel: '',
  descriptionLabel: '',
  name: '',
  description: ''
};

  currentFormulaName: string = '';
  selectedSubnets: any[] = [];
  showFrequencyModal = false;
  updateFrequency = 'manual';
  updateFrequencies = [
    { value: 'manual', label: 'Manual Only' },
    { value: 'hourly', label: 'Every Hour' },
    { value: 'minute', label: 'Every Minute (Testing)' },
    { value: 'daily', label: 'Once Daily' },
    { value: 'weekly', label: 'Once Weekly' },
    { value: 'monthly', label: 'Once Monthly' }
  ];
  private frequencyResolve: ((value: string | null) => void) | null = null;

  notifications: Array<{
  id: number;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
  timestamp: number;
}> = [];

private notificationId = 0;

  targetProperty = 'Risk Score';

  // Calculation methods
  availableMethods: CalculationMethod[] = [
    { id: 'weighted_avg', name: 'Weighted Average', type: 'calculation', icon: '⚖️', description: 'Components * weights / total weights' },
    { id: 'max', name: 'Maximum Score', type: 'calculation', icon: '📈', description: 'Highest component score' },
    { id: 'sum', name: 'Sum Total', type: 'calculation', icon: '➕', description: 'Add all component scores' },
    { id: 'geometric_mean', name: 'Geometric Mean', type: 'calculation', icon: '🔢', description: 'nth root of product' },
    { id: 'custom_formula', name: 'Custom Formula', type: 'calculation', icon: '🧮', description: 'User-defined calculation' }
  ];

  selectedMethod = 'weighted_avg';
  customFormula = '';

  showCustomComponentModal = false;
  customComponent = {
    name: '',
    category: '',
    maxValue: 10
  };

@ViewChild('componentList', { static: false }) componentList!: CdkDropList;
@ViewChild('formulaArea', { static: false }) formulaArea!: CdkDropList;

  constructor(
    private http: HttpClient,
    private networkDataService: NetworkDataService,
    private riskComponentsService: RiskComponentsService,
    private riskConfigService: RiskConfigService
  ) {}

  async ngOnInit() {
  this.isLoadingComponents = true;

  // Initialize components with zero values in Neo4j
  await this.riskComponentsService.initializeComponentsInNeo4j();

  this.loadCustomComponents();
  
  setTimeout(() => {
    this.loadComponentsFromConfig();
  }, 100);
  
  this.loadNetworkData();
  this.loadActiveAutomations();
  
  // Initialize hierarchical networks
  setTimeout(() => {
    this.initializeHierarchicalNetworks();
  }, 200);
  
  // Load formulas after components are loaded
  setTimeout(() => {
    this.loadFormulas();
  }, 500);
}

loadActiveAutomations(): void {
  this.isLoadingAutomations = true;
  
  // Use the correct endpoint for risk automations
  this.http.get<any>('http://localhost:5000/api/risk/automations/active')
    .subscribe({
      next: (response) => {
        if (response.success && response.automations) {
          this.activeAutomations = Object.keys(response.automations).map(key => ({
            id: key,
            enabled: response.automations[key].enabled !== false,
            ...response.automations[key]
          }));
        } else {
          this.activeAutomations = [];
        }
        this.isLoadingAutomations = false;
      },
      error: (error) => {
        console.error('Error loading active automations:', error);
        this.showError('Load Failed', 'Failed to load active automations');
        this.activeAutomations = [];
        this.isLoadingAutomations = false;
      }
    });
}

getFilteredAutomations(): ActiveAutomation[] {
  switch (this.automationFilter) {
    case 'enabled':
      return this.activeAutomations.filter(a => a.enabled !== false);
    case 'disabled':
      return this.activeAutomations.filter(a => a.enabled === false);
    default:
      return this.activeAutomations;
  }
}

getActiveAutomationsCount(): number {
  return this.activeAutomations.filter(a => a.enabled !== false).length;
}

getDisabledAutomationsCount(): number {
  return this.activeAutomations.filter(a => a.enabled === false).length;
}

async pauseAutomation(automation: ActiveAutomation): Promise<void> {
  const confirmed = await this.showConfirm(
    'Pause Automation',
    `Are you sure you want to pause "${this.getComponentName(automation)}" automation?`,
    'Pause',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  this.http.put(`http://localhost:5000/api/components/automation/${automation.id}/pause`, {})
    .subscribe({
      next: () => {
        automation.enabled = false;
        this.showSuccess('Automation Paused', `${this.getComponentName(automation)} automation has been paused`);
      },
      error: (error) => {
        this.showError('Pause Failed', error.error?.message || 'Failed to pause automation');
      }
    });
}

async resumeAutomation(automation: ActiveAutomation): Promise<void> {
  const confirmed = await this.showConfirm(
    'Resume Automation',
    `Are you sure you want to resume "${this.getComponentName(automation)}" automation?`,
    'Resume',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  this.http.put(`http://localhost:5000/api/components/automation/${automation.id}/resume`, {})
    .subscribe({
      next: () => {
        automation.enabled = true;
        this.showSuccess('Automation Resumed', `${this.getComponentName(automation)} automation has been resumed`);
      },
      error: (error) => {
        this.showError('Resume Failed', error.error?.message || 'Failed to resume automation');
      }
    });
}

getAutomationStatusText(automation: ActiveAutomation): string {
  const enabled = automation.enabled !== false;
  if (!enabled) return 'Paused';
  
  const lastRun = automation.last_run || automation.lastRun;
  const updateFreq = automation.update_frequency || automation.updateFrequency;
  
  if (updateFreq === 'manual') return 'Manual';
  if (!lastRun) return 'Pending';
  
  return 'Active';
}

async deleteAutomation(automation: ActiveAutomation): Promise<void> {
  const confirmed = await this.showConfirm(
    'Delete Automation',
    `Are you sure you want to delete "${automation.componentName}" automation?\n\nThis action cannot be undone.`,
    'Delete',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  this.http.delete(`http://localhost:5000/api/components/automation/${automation.id}`)
    .subscribe({
      next: () => {
        this.activeAutomations = this.activeAutomations.filter(a => a.id !== automation.id);
        this.showSuccess('Automation Deleted', `${automation.componentName} automation has been deleted`);
      },
      error: (error) => {
        this.showError('Delete Failed', error.error?.message || 'Failed to delete automation');
      }
    });
}

getAutomationStatusClass(automation: ActiveAutomation): string {
  const status = this.getAutomationStatusText(automation);
  switch (status) {
    case 'Active': return 'status-active';
    case 'Paused': return 'status-paused';
    case 'Expired': return 'status-expired';
    default: return '';
  }
}

getAutomationTarget(automation: ActiveAutomation): string {
  const targetType = automation.target_type || automation.targetType;
  const targetValues = automation.target_values || automation.targetValues || [];
  
  switch (targetType) {
    case 'subnet':
      if (targetValues.length === 1) {
        return `Subnet: ${targetValues[0]}`;
      } else if (targetValues.length > 1) {
        return `${targetValues.length} Subnets`;
      }
      return 'Subnet';
    case 'ip':
      if (targetValues.length === 1) {
        return `IP: ${targetValues[0]}`;
      } else if (targetValues.length > 1) {
        return `${targetValues.length} IPs`;
      }
      return 'IP';
    case 'network':
      if (targetValues.length === 1) {
        return `Net: ${targetValues[0]}`;
      } else if (targetValues.length > 1) {
        return `${targetValues.length} Networks`;
      }
      return 'Network';
    case 'all':
      return 'All Nodes';
    default:
      return targetType || 'Unknown';
  }
}

getNextRunTime(automation: ActiveAutomation): string {
  const enabled = automation.enabled;
  if (enabled === false) return 'Paused';
  
  const updateFrequency = automation.update_frequency || automation.updateFrequency;
  if (updateFrequency === 'manual') return 'Manual';
  
  const lastRunStr = automation.last_run || automation.lastRun;
  if (!lastRunStr) {
    return 'Pending';
  }
  
  const lastRun = new Date(lastRunStr);
  let nextRun = new Date(lastRun);
  
  switch (updateFrequency) {
    case 'minute':
      nextRun.setMinutes(nextRun.getMinutes() + 1);
      break;
    case 'hourly':
      nextRun.setHours(nextRun.getHours() + 1);
      break;
    case 'daily':
      nextRun.setDate(nextRun.getDate() + 1);
      break;
    case 'weekly':
      nextRun.setDate(nextRun.getDate() + 7);
      break;
    case 'monthly':
      nextRun.setMonth(nextRun.getMonth() + 1);
      break;
    default:
      return 'Unknown';
  }
  
  const now = new Date();
  const diffMs = nextRun.getTime() - now.getTime();
  
  if (diffMs <= 0) return 'Due now';
  
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) return `${diffMins}m`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

formatLastRun(lastRun: string | undefined): string {
  if (!lastRun) return 'Never';
  
  const date = new Date(lastRun);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

getComponentName(automation: ActiveAutomation): string {
  return automation.formula_name || 
         automation.componentName || 
         'Unknown Formula';
}

getNodesUpdated(automation: ActiveAutomation): string {
  const nodesUpdated = automation.nodes_updated;
  if (nodesUpdated === undefined || nodesUpdated === null) return '';
  if (nodesUpdated === 0) return '0 nodes';
  if (nodesUpdated === 1) return '1 node';
  return `${nodesUpdated} nodes`;
}

getRiskScore(automation: ActiveAutomation): string {
  const avgRisk = automation.avg_risk_score;
  if (avgRisk === null || avgRisk === undefined) return '';
  return `Risk: ${avgRisk.toFixed(1)}`;
}

formatUpdateFrequency(frequency: string | undefined): string {
  if (!frequency) return 'Manual';
  
  const frequencyMap: { [key: string]: string } = {
    'manual': 'Manual',
    'minute': 'Every Min',
    'hourly': 'Hourly', 
    'daily': 'Daily',
    'weekly': 'Weekly',
    'monthly': 'Monthly'
  };
  return frequencyMap[frequency] || frequency;
}


// Network tree interaction methods
toggleNetworkNode(networkIndex: number): void {
  const network = this.hierarchicalNetworks[networkIndex];
  if (network) {
    network.expanded = !network.expanded;
  }
}

toggleNetworkExpansion(networkIndex: number, event: Event): void {
  event.stopPropagation();
  this.toggleNetworkNode(networkIndex);
}

toggleSubnetExpansion(networkIndex: number, subnetIndex: number, event: Event): void {
  event.stopPropagation();
  const network = this.hierarchicalNetworks[networkIndex];
  const subnet = network?.subnets[subnetIndex];
  if (subnet) {
    subnet.expanded = !subnet.expanded;
    
    // Re-sort subnets to move expanded ones to the top
    network.subnets = this.sortSubnets(network.subnets);
    
    // If we expanded and there are devices, load them if needed
    if (subnet.expanded && (!subnet.devices || subnet.devices.length === 0)) {
      this.loadSubnetDevices(subnet);
    }
  }
}

private async loadSubnetDevices(subnet: SubnetData): Promise<void> {
  try {
    console.log(`Loading devices for subnet: ${subnet.subnet}`);
    const result = await this.networkDataService.getSubnetDetails(subnet.subnet);
    if (result && result.devices) {
      // Convert DeviceData[] to NetworkDevice[] and ensure type compatibility
      subnet.devices = result.devices.map((device: any) => ({
        ip: String(device.ip || device.address || ''),
        hostname: device.hostname || device.name || 'Unknown',
        riskScore: typeof device.riskScore === 'number' ? device.riskScore : 0,
        isActive: device.isActive !== false,
        selected: false,
        hidden: false,
        isMatch: false,
        deviceType: device.deviceType || device.type || 'Network Device',
        os: device.os || device.operatingSystem || 'Unknown',
        vulnerabilities: Array.isArray(device.vulnerabilities) ? device.vulnerabilities.length : (typeof device.vulnerabilities === 'number' ? device.vulnerabilities : 0)
      }));
      
      subnet.hasDetailedData = true;
      
      // Initialize visible devices
      subnet.visibleDevices = subnet.devices.slice(0, 15).map((device: NetworkDevice) => ({
        ...device,
        selected: false,
        hidden: false,
        isMatch: false
      }));
      
      console.log(`Loaded ${subnet.devices.length} devices for subnet ${subnet.subnet}`);
    }
  } catch (error) {
    console.error(`Error loading devices for subnet ${subnet.subnet}:`, error);
  }
}

private reSortAllSubnets(): void {
  this.hierarchicalNetworks.forEach(network => {
    network.subnets = this.sortSubnets(network.subnets);
  });
}

// Selection methods
selectEntireNetwork(networkIndex: number): void {
  const network = this.hierarchicalNetworks[networkIndex];
  if (!network) return;
  
  // When network is selected, deselect all subnets and IPs
  network.subnets.forEach(subnet => {
    subnet.selected = false;
    if (subnet.devices) {
      subnet.devices.forEach(device => {
        device.selected = false;
      });
    }
    if (subnet.visibleDevices) {
      subnet.visibleDevices.forEach(device => {
        device.selected = false;
      });
    }
  });
  
  this.updateSelectionCounts();
}

selectEntireSubnet(networkIndex: number, subnetIndex: number): void {
  const network = this.hierarchicalNetworks[networkIndex];
  const subnet = network?.subnets[subnetIndex];
  if (!subnet) return;
  
  // When subnet is selected, deselect network and individual IPs
  network.selected = false;
  if (subnet.devices) {
    subnet.devices.forEach(device => {
      device.selected = false;
    });
  }
  if (subnet.visibleDevices) {
    subnet.visibleDevices.forEach(device => {
      device.selected = false;
    });
  }
  
  this.updateSelectionCounts();
}

// Update these method signatures
loadMoreIPs(networkIndex: number, subnetIndex: number): void {
  const subnet: SubnetData | undefined = this.hierarchicalNetworks[networkIndex]?.subnets[subnetIndex];
  if (!subnet || !subnet.devices) return;
  
  const currentVisible = subnet.visibleDevices?.length || 0;
  const nextBatch = subnet.devices.slice(currentVisible, currentVisible + 20);
  
  // Map real devices to include selection state
  const mappedBatch: NetworkDevice[] = nextBatch.map((device: NetworkDevice) => ({
    ...device,
    selected: false,
    hidden: false,
    isMatch: false
  }));
  
  if (!subnet.visibleDevices) {
    subnet.visibleDevices = [];
  }
  subnet.visibleDevices.push(...mappedBatch);
}

selectIndividualIP(networkIndex: number, subnetIndex: number, ipIndex: number): void {
  const network: NetworkData | undefined = this.hierarchicalNetworks[networkIndex];
  const subnet: SubnetData | undefined = network?.subnets[subnetIndex];
  if (!subnet) return;
  
  // When individual IP is selected, deselect network and subnet
  if (network) {
    network.selected = false;
  }
  subnet.selected = false;
  
  // Sync visible device selection with main devices array
  const visibleDevice: NetworkDevice | undefined = subnet.visibleDevices?.[ipIndex];
  if (visibleDevice && subnet.devices) {
    const originalDevice = subnet.devices.find((d: NetworkDevice) => d.ip === visibleDevice.ip);
    if (originalDevice) {
      originalDevice.selected = visibleDevice.selected;
    }
  }
  
  this.updateSelectionCounts();
}

private initializeHierarchicalNetworks(): void {
  const networkMap = new Map<string, NetworkData>();
  const currentData = this.networkDataService.getCurrentNetworkData();
  
  currentData.forEach((subnet: any) => {
    const networkPrefix = subnet.subnet.split('.').slice(0, 2).join('.');
    if (!networkMap.has(networkPrefix)) {
      networkMap.set(networkPrefix, {
        prefix: networkPrefix,
        subnets: [],
        totalDevices: 0,
        expanded: false,
        selected: false,
        hidden: false,
        isMatch: false
      });
    }
    const network = networkMap.get(networkPrefix)!;
    
    // Use real subnet data with real devices if available
    const subnetData: SubnetData = {
      ...subnet,
      devices: subnet.devices || [],
      visibleDevices: [],
      expanded: false,
      selected: false,
      hidden: false,
      isMatch: false
    };
    
    // Show first 15 real devices if they exist
    if (subnetData.devices && subnetData.devices.length > 0) {
      subnetData.visibleDevices = subnetData.devices.slice(0, 15).map((device: any) => ({
        ...device,
        selected: false,
        hidden: false,
        isMatch: false
      }));
    }
    
    network.subnets.push(subnetData);
    network.totalDevices += subnetData.devices?.length || subnet.deviceCount || 0;
  });

  // Sort subnets within each network
  networkMap.forEach(network => {
    network.subnets = this.sortSubnets(network.subnets);
  });

  this.hierarchicalNetworks = Array.from(networkMap.values());
  console.log('Initialized hierarchical networks with real data:', this.hierarchicalNetworks);
}

private sortSubnets(subnets: SubnetData[]): SubnetData[] {
  return subnets.sort((a, b) => {
    // First priority: expanded subnets come first
    if (a.expanded !== b.expanded) {
      return a.expanded ? -1 : 1;
    }
    
    // Second priority: subnets with detailed data (devices loaded) come next
    const aHasData = (a.devices && a.devices.length > 0) || a.hasDetailedData;
    const bHasData = (b.devices && b.devices.length > 0) || b.hasDetailedData;
    if (aHasData !== bHasData) {
      return aHasData ? -1 : 1;
    }
    
    // Third priority: sort by IP address numerically
    return this.compareIPAddresses(a.subnet, b.subnet);
  });
}

private compareIPAddresses(subnetA: string, subnetB: string): number {
  // Extract IP parts from subnet CIDR (e.g., "192.168.1.0/24" -> [192, 168, 1, 0])
  const getIPParts = (subnet: string): number[] => {
    const ip = subnet.split('/')[0]; // Remove CIDR suffix
    return ip.split('.').map(part => parseInt(part, 10));
  };
  
  const partsA = getIPParts(subnetA);
  const partsB = getIPParts(subnetB);
  
  // Compare each octet
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;
    
    if (partA !== partB) {
      return partA - partB;
    }
  }
  
  return 0; // Equal
}

performNetworkSearch(): void {
  const searchTerm = this.networkSearchTerm.toLowerCase().trim();
  this.networkSearchResults = [];
  
  if (!searchTerm) {
    // If no search term but we have an active filter, apply it
    if (this.networkSearchFilter && this.networkSearchFilter !== 'all') {
      this.setNetworkSearchFilter(this.networkSearchFilter);
    } else {
      this.clearNetworkSearchResults();
    }
    return;
  }
  
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    let networkMatches = false;
    
    // Search network level
    if ((this.networkSearchFilter === 'all' || this.networkSearchFilter === 'networks') &&
        network.prefix.toLowerCase().includes(searchTerm)) {
      networkMatches = true;
      network.isMatch = true;
      this.networkSearchResults.push({ type: 'network', element: network });
    }
    
    // Search subnets
    network.subnets.forEach((subnet: SubnetData) => {
      let subnetMatches = false;
      
      if ((this.networkSearchFilter === 'all' || this.networkSearchFilter === 'subnets') &&
          subnet.subnet.toLowerCase().includes(searchTerm)) {
        subnetMatches = true;
        subnet.isMatch = true;
        networkMatches = true;
        this.networkSearchResults.push({ type: 'subnet', element: subnet });
      }
      
      // Search real device data
      if ((this.networkSearchFilter === 'all' || this.networkSearchFilter === 'ips') && subnet.devices && subnet.devices.length > 0) {
  subnet.devices.forEach((device: NetworkDevice) => {
    const ipMatch = device.ip && device.ip.includes(searchTerm);
    const hostnameMatch = device.hostname && device.hostname.toLowerCase().includes(searchTerm);
    
    if (ipMatch || hostnameMatch) {
      device.isMatch = true;
      subnetMatches = true;
      networkMatches = true;
      this.networkSearchResults.push({ type: 'ip', element: device });
      
      // Make sure this device is visible
      if (subnet.visibleDevices && !subnet.visibleDevices.some((vd: NetworkDevice) => vd.ip === device.ip)) {
        subnet.visibleDevices.push({
          ...device,
          selected: false,
          hidden: false,
          isMatch: true
        });
      }
    }
  });
}
      
      subnet.hidden = !subnetMatches;
    });
    
    network.hidden = !networkMatches;
  });
}

private filterHighRiskItems(): void {
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    let networkHasHighRisk = false;
    
    network.subnets.forEach((subnet: SubnetData) => {
      let subnetHasHighRisk = false;
      
      // Check if subnet itself has high risk
      if (subnet.riskScore && subnet.riskScore >= 7) {
        subnet.isMatch = true;
        subnetHasHighRisk = true;
        networkHasHighRisk = true;
        this.networkSearchResults.push({ type: 'subnet', element: subnet });
      }
      
      // Check devices for high risk
      if (subnet.devices && subnet.devices.length > 0) {
        subnet.devices.forEach((device: NetworkDevice) => {
          if (device.riskScore && device.riskScore >= 7) {
            device.isMatch = true;
            subnetHasHighRisk = true;
            networkHasHighRisk = true;
            this.networkSearchResults.push({ type: 'ip', element: device });
          }
        });
      }
      
      subnet.hidden = !subnetHasHighRisk;
    });
    
    network.hidden = !networkHasHighRisk;
  });
}

private calculateTotalTargets(): number {
  let totalTargets = 0;
  
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    if (network.selected) {
      // Count all devices in all subnets of this network
      network.subnets.forEach((subnet: SubnetData) => {
        totalTargets += subnet.devices?.length || subnet.deviceCount || 0;
      });
    } else {
      network.subnets.forEach((subnet: SubnetData) => {
        if (subnet.selected) {
          // Count all devices in this subnet
          totalTargets += subnet.devices?.length || subnet.deviceCount || 0;
        } else {
          // Count only selected individual devices
          if (subnet.devices) {
            subnet.devices.forEach((device: NetworkDevice) => {
              if (device.selected) {
                totalTargets++;
              }
            });
          }
        }
      });
    }
  });
  
  return totalTargets;
}

private updateSelectionCounts(): void {
  // Sync visible device selections with main device array
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    network.subnets.forEach((subnet: SubnetData) => {
      if (subnet.visibleDevices && subnet.devices) {
        subnet.visibleDevices.forEach((visibleDevice: NetworkDevice) => {
          const originalDevice = subnet.devices!.find((d: NetworkDevice) => d.ip === visibleDevice.ip);
          if (originalDevice) {
            originalDevice.selected = visibleDevice.selected;
          }
        });
      }
    });
  });
}

setNetworkSearchFilter(filter: string): void {
  this.networkSearchFilter = filter;
  console.log('Filter changed to:', filter);
  
  // Clear previous results and reset visibility
  this.clearNetworkSearchResults();
  
  if (filter === 'high-risk') {
    this.filterHighRiskItems();
  } else if (filter === 'all') {
    // Show all networks and subnets
    this.showAllNetworks();
  } else {
    // Apply the filter even without search term
    this.applyFilterCriteria(filter);
  }
}

private showAllNetworks(): void {
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    network.hidden = false;
    network.isMatch = false;
    
    network.subnets.forEach((subnet: SubnetData) => {
      subnet.hidden = false;
      subnet.isMatch = false;
      
      if (subnet.devices) {
        subnet.devices.forEach((device: NetworkDevice) => {
          device.hidden = false;
          device.isMatch = false;
        });
      }
      
      if (subnet.visibleDevices) {
        subnet.visibleDevices.forEach((device: NetworkDevice) => {
          device.hidden = false;
          device.isMatch = false;
        });
      }
    });
  });
}

private applyFilterCriteria(filter: string): void {
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    let networkHasMatches = false;
    
    network.subnets.forEach((subnet: SubnetData) => {
      let subnetHasMatches = false;
      
      // Apply filter based on type
      if (filter === 'networks') {
        // Networks filter - always show networks but hide subnets/IPs
        networkHasMatches = true;
        subnetHasMatches = false;
      } else if (filter === 'subnets') {
        // Subnets filter - show networks that have subnets
        subnetHasMatches = true;
        networkHasMatches = true;
        subnet.isMatch = true;
        this.networkSearchResults.push({ type: 'subnet', element: subnet });
      } else if (filter === 'ips') {
        // IPs Only filter - show networks/subnets that have devices
        if (subnet.devices && subnet.devices.length > 0) {
          subnetHasMatches = true;
          networkHasMatches = true;
          
          // Mark matching devices and ensure they're visible
          subnet.devices.forEach((device: NetworkDevice) => {
            device.isMatch = true;
            this.networkSearchResults.push({ type: 'ip', element: device });
            
            // Make sure device is in visible devices
            if (subnet.visibleDevices && !subnet.visibleDevices.some((vd: NetworkDevice) => vd.ip === device.ip)) {
              subnet.visibleDevices.push({
                ...device,
                selected: false,
                hidden: false,
                isMatch: true
              });
            }
          });
        }
      }
      
      subnet.hidden = !subnetHasMatches;
    });
    
    network.hidden = !networkHasMatches;
  });
}


clearNetworkSearch(): void {
  this.networkSearchTerm = '';
  this.clearNetworkSearchResults();
}

private clearNetworkSearchResults(): void {
  this.networkSearchResults = [];
  
  this.hierarchicalNetworks.forEach((network: NetworkData) => {
    network.hidden = false;
    network.isMatch = false;
    
    network.subnets.forEach((subnet: SubnetData) => {
      subnet.hidden = false;
      subnet.isMatch = false;
      
      if (subnet.devices && subnet.devices.length > 0) {
        subnet.devices.forEach((device: NetworkDevice) => {
          device.hidden = false;
          device.isMatch = false;
        });
      }
      
      if (subnet.visibleDevices && subnet.visibleDevices.length > 0) {
        subnet.visibleDevices.forEach((device: NetworkDevice) => {
          device.hidden = false;
          device.isMatch = false;
        });
      }
    });
  });
}

expandAllNetworkResults(): void {
  let hasChanges = false;
  
  this.networkSearchResults.forEach(result => {
    if (result.type === 'ip') {
      const device = result.element;
      this.hierarchicalNetworks.forEach(network => {
        network.subnets.forEach(subnet => {
          if (subnet.devices && subnet.devices.some(d => d.ip === device.ip)) {
            if (!network.expanded) {
              network.expanded = true;
              hasChanges = true;
            }
            if (!subnet.expanded) {
              subnet.expanded = true;
              hasChanges = true;
            }
          }
        });
      });
    } else if (result.type === 'subnet') {
      const subnetElement = result.element;
      this.hierarchicalNetworks.forEach(network => {
        if (network.subnets.includes(subnetElement)) {
          if (!network.expanded) {
            network.expanded = true;
            hasChanges = true;
          }
        }
      });
    } else if (result.type === 'network') {
      if (!result.element.expanded) {
        result.element.expanded = true;
        hasChanges = true;
      }
    }
  });
  
  // Re-sort if any changes were made
  if (hasChanges) {
    this.reSortAllSubnets();
  }
}

// Selection summary methods
getNetworkSelectionSummary(): string {
  let networkCount = 0;
  let subnetCount = 0;
  let ipCount = 0;
  
  this.hierarchicalNetworks.forEach(network => {
    if (network.selected) {
      networkCount++;
    } else {
      network.subnets.forEach(subnet => {
        if (subnet.selected) {
          subnetCount++;
        } else {
          if (subnet.devices) {
            subnet.devices.forEach(device => {
              if (device.selected) {
                ipCount++;
              }
            });
          }
        }
      });
    }
  });
  
  const parts = [];
  if (networkCount > 0) parts.push(`${networkCount} network${networkCount > 1 ? 's' : ''}`);
  if (subnetCount > 0) parts.push(`${subnetCount} subnet${subnetCount > 1 ? 's' : ''}`);
  if (ipCount > 0) parts.push(`${ipCount} IP${ipCount > 1 ? 's' : ''}`);
  
  return parts.length > 0 ? parts.join(' • ') + ' selected' : 'No selections made';
}

getNetworkSelectionDetails(): string {
  const totalTargets = this.calculateTotalTargets();
  return totalTargets > 0 ? `Total estimated targets: ${totalTargets.toLocaleString()} devices` : '';
}

getTotalSelectedCount(): number {
  return this.calculateTotalTargets();
}

clearAllNetworkSelections(): void {
  this.hierarchicalNetworks.forEach(network => {
    network.selected = false;
    network.subnets.forEach(subnet => {
      subnet.selected = false;
      if (subnet.devices) {
        subnet.devices.forEach(device => {
          device.selected = false;
        });
      }
      if (subnet.visibleDevices) {
        subnet.visibleDevices.forEach(device => {
          device.selected = false;
        });
      }
    });
  });
}

// Apply selected hierarchy to automation
async applyToSelectedHierarchy(): Promise<void> {
  const selectedData = this.gatherSelectedTargets();
  
  if (selectedData.totalTargets === 0) {
    this.showWarning('Selection Required', 'Please select at least one network, subnet, or IP address.');
    return;
  }
  
  this.closeIpModal();
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  // Determine the most specific target type
  let targetType = 'mixed';
  let targetValues: string[] = [];
  
  if (selectedData.selectedNetworks.length > 0 && selectedData.selectedSubnets.length === 0 && selectedData.selectedIPs.length === 0) {
    targetType = 'network';
    targetValues = selectedData.selectedNetworks;
  } else if (selectedData.selectedSubnets.length > 0 && selectedData.selectedNetworks.length === 0 && selectedData.selectedIPs.length === 0) {
    targetType = 'subnet';
    targetValues = selectedData.selectedSubnets;
  } else if (selectedData.selectedIPs.length > 0 && selectedData.selectedNetworks.length === 0 && selectedData.selectedSubnets.length === 0) {
    targetType = 'ip';
    targetValues = selectedData.selectedIPs;
  } else {
    // Mixed selection - use the most comprehensive approach
    targetType = 'mixed';
    targetValues = [...selectedData.selectedNetworks, ...selectedData.selectedSubnets, ...selectedData.selectedIPs];
  }
  
  const confirmMessage = `Apply risk calculation to selected targets?\n\nSelection: ${selectedData.summary}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\nEstimated targets: ${selectedData.totalTargets}\n\nContinue?`;
  
  const confirmed = await this.showConfirm(
    'Apply to Selected Targets',
    confirmMessage,
    'Continue',
    'Cancel'
  );
  
  if (!confirmed) return;

  const frequency = await this.askUpdateFrequency();
  if (!frequency) return;
  
  try {
    const config: RiskConfigurationRequest = {
      formulaName: this.currentFormulaName || 'Custom Formula',
      components: this.prepareComponentData(),
      targetType: targetType,
      targetValues: targetValues,
      calculationMode: 'calculate',
      calculationMethod: this.selectedMethod,
      customFormula: this.customFormula,
      updateFrequency: frequency,
      targetProperty: this.targetProperty || 'Risk Score'
    };

    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied', 
        `Updated ${response.nodesUpdated} nodes\nAverage Risk Score: ${response.avgRiskScore.toFixed(2)}`
      );
      
      if (response.automationEnabled) {
        this.showInfo('Automation Enabled', `Risk calculation will run ${frequency}`);
      }
      
      this.riskFormula = [];
      this.loadActiveAutomations(); // Refresh automations list
    }
    
    this.clearAllNetworkSelections();
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying configuration:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Application Failed', `Failed to apply risk configuration: ${errorMessage}`);
  }
}

// Gather real selected targets for automation
private gatherSelectedTargets(): any {
  const selectedNetworks: string[] = [];
  const selectedSubnets: string[] = [];
  const selectedIPs: string[] = [];
  let totalTargets = 0;
  
  this.hierarchicalNetworks.forEach(network => {
    if (network.selected) {
      selectedNetworks.push(network.prefix);
      totalTargets += network.totalDevices;
    } else {
      network.subnets.forEach(subnet => {
        if (subnet.selected) {
          selectedSubnets.push(subnet.subnet);
          totalTargets += subnet.devices ? subnet.devices.length : (subnet.deviceCount || 0);
        } else {
          // Check both devices and visibleDevices arrays for selections
          const devicesToCheck = subnet.devices || [];
          const visibleDevicesToCheck = subnet.visibleDevices || [];
          
          // First check visible devices and sync with main devices array
          visibleDevicesToCheck.forEach(visibleDevice => {
            if (visibleDevice.selected) {
              const originalDevice = devicesToCheck.find(d => d.ip === visibleDevice.ip);
              if (originalDevice) {
                originalDevice.selected = true;
              }
            }
          });
          
          // Now count all selected devices
          devicesToCheck.forEach(device => {
            if (device.selected && device.ip) {
              selectedIPs.push(device.ip);
              totalTargets++;
            }
          });
        }
      });
    }
  });
  
  const parts = [];
  if (selectedNetworks.length > 0) parts.push(`${selectedNetworks.length} network(s)`);
  if (selectedSubnets.length > 0) parts.push(`${selectedSubnets.length} subnet(s)`);
  if (selectedIPs.length > 0) parts.push(`${selectedIPs.length} IP(s)`);
  
  return {
    selectedNetworks,
    selectedSubnets,
    selectedIPs,
    totalTargets,
    summary: parts.join(', ') || 'No selections'
  };
}
  
  private async loadNetworkData() {
  console.log('Loading network data...');
  const currentData = this.networkDataService.getCurrentNetworkData();
  
  // Store all subnets without limit
  this.availableSubnets = currentData;
  this.filteredSubnets = currentData;
}

filterSubnets() {
  if (!this.subnetSearchTerm || this.subnetSearchTerm.trim() === '') {
    this.filteredSubnets = this.availableSubnets;
  } else {
    const searchTerm = this.subnetSearchTerm.toLowerCase();
    this.filteredSubnets = this.availableSubnets.filter(subnet => 
      subnet.subnet.toLowerCase().includes(searchTerm) ||
      subnet.deviceCount.toString().includes(searchTerm)
    );
  }
}

private askUpdateFrequency(): Promise<string | null> { 
  return new Promise((resolve) => {
    this.updateFrequency = 'manual'; // Default selection
    this.showFrequencyModal = true;
    
    // Store the resolve function to use when modal closes
    this.frequencyResolve = resolve;
  });
}

selectUpdateFrequency(frequency: string) {
  this.updateFrequency = frequency;
  this.showFrequencyModal = false;
  
  if (this.frequencyResolve) {
    this.frequencyResolve(frequency);
    this.frequencyResolve = null;
  }
}

cancelFrequencyModal() {
  this.showFrequencyModal = false;
  
  if (this.frequencyResolve) {
    this.frequencyResolve(null);
    this.frequencyResolve = null;
  }
}

  drop(event: CdkDragDrop<RiskComponent[]>) {
  if (event.previousContainer === event.container) {
    moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
  } else {
    // Get the component being transferred
    const component = event.previousContainer.data[event.previousIndex];
    
    // Ensure valid values before transferring
    component.weight = this.validateNumber(component.weight, 0.2);
    component.currentValue = this.validateNumber(component.currentValue, 0);
    component.maxValue = this.validateNumber(component.maxValue, 100);
    
    // Ensure neo4jProperty exists
    if (!component.neo4jProperty) {
      component.neo4jProperty = component.name.replace(/[^a-zA-Z0-9]/g, '_');
    }
    
    console.log('Dropping component with neo4jProperty:', component.neo4jProperty);
    
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );
  }
  
  // Auto-update custom formula when components change
  if (this.selectedMethod === 'custom_formula') {
    this.updateCustomFormulaFromComponents();
  }
}

  removeFromFormula(index: number) {
    const item = this.riskFormula[index];
    this.riskFormula.splice(index, 1);
    this.availableComponents.push(item);
    
    if (this.selectedMethod === 'custom_formula') {
      this.updateCustomFormulaFromComponents();
    }
  }

  clearFormula() {
    this.availableComponents.push(...this.riskFormula);
    this.riskFormula = [];
    
    if (this.selectedMethod === 'custom_formula') {
      this.customFormula = '';
    }
  }

  onMethodChange(methodId: string) {
    this.selectedMethod = methodId;
    
    if (methodId === 'custom_formula') {
      this.updateCustomFormulaFromComponents();
    }
  }

  updateWeight(component: RiskComponent, event: any) {
  const inputValue = (event.target as HTMLInputElement).value;
  const newWeight = parseFloat(inputValue);
  
  // Validate and prevent reset
  if (!isNaN(newWeight) && newWeight >= 0 && newWeight <= 1) {
    component.weight = newWeight;
    console.log(`Updated weight for ${component.name} to ${newWeight}`);
  } else {
    // Keep the existing weight if invalid input
    console.warn(`Invalid weight input: ${inputValue}, keeping ${component.weight}`);
    // Reset the input to show the valid weight
    (event.target as HTMLInputElement).value = component.weight.toString();
  }
}
  
  // Simulate risk calculation preview using data
  calculatePreviewRisk(): number {
    if (this.riskFormula.length === 0) return 0;

    switch (this.selectedMethod) {
      case 'weighted_avg':
        const totalWeighted = this.riskFormula.reduce((sum, comp) => {
          const value = comp.currentValue || comp.statistics?.avg || 0;
          return sum + (value * comp.weight);
        }, 0);
        const totalWeights = this.riskFormula.reduce((sum, comp) => sum + comp.weight, 0);
        return totalWeights > 0 ? totalWeighted / totalWeights : 0;
      
      case 'max':
        return Math.max(...this.riskFormula.map(comp => comp.currentValue || comp.statistics?.avg || 0));
      
      case 'sum':
        return this.riskFormula.reduce((sum, comp) => sum + (comp.currentValue || comp.statistics?.avg || 0), 0);

      case 'custom_formula':
        if (!this.customFormula.trim()) return 0;
        
        try {
          let formulaToEvaluate = this.customFormula;
          
          this.riskFormula.forEach(comp => {
            const value = comp.currentValue || comp.statistics?.avg || 0;
            const regex = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            formulaToEvaluate = formulaToEvaluate.replace(regex, value.toFixed(2));
          });
          
          const result = this.evaluateSimpleExpression(formulaToEvaluate);
          return Math.max(0, Math.min(result, 10));
        } catch (error) {
          const totalWeighted = this.riskFormula.reduce((sum, comp) => {
            const value = comp.currentValue || comp.statistics?.avg || 0;
            return sum + (value * comp.weight);
          }, 0);
          return Math.min(totalWeighted, 10);
        }

      case 'geometric_mean':
        const product = this.riskFormula.reduce((prod, comp) => {
          const value = comp.currentValue || comp.statistics?.avg || 1;
          return prod * Math.max(value, 0.1);
        }, 1);
        return Math.pow(product, 1 / this.riskFormula.length);
      
      default:
        return 0;
    }
  }

  getResultRiskClass(riskScore: number): string {
    if (riskScore >= 9.0) return 'result-critical';
    if (riskScore >= 7.0) return 'result-high'; 
    if (riskScore >= 4.0) return 'result-medium';
    return 'result-low';
  }

  private evaluateSimpleExpression(expression: string): number {
    try {
      const cleanExpression = expression.replace(/\s+/g, '');
      
      if (!/^[\d+\-*/().^]+$/.test(cleanExpression)) {
        throw new Error('Invalid characters in expression');
      }
      
      const jsExpression = cleanExpression.replace(/\^/g, '**');
      const result = new Function('return ' + jsExpression)();
      
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.warn('Formula evaluation error:', error);
      return 0;
    }
  }

// Notification helper methods
private showNotification(type: 'success' | 'info' | 'warning' | 'error', title: string, message: string) {
  const notification = {
    id: ++this.notificationId,
    type,
    title,
    message,
    timestamp: Date.now()
  };
  
  this.notifications.push(notification);
  
  // Auto-dismiss after 5 seconds (except for errors which stay longer)
  const dismissTime = type === 'error' ? 8000 : 5000;
  setTimeout(() => {
    this.dismissNotification(notification.id);
  }, dismissTime);
}

private showSuccess(title: string, message: string) {
  this.showNotification('success', title, message);
}

private showError(title: string, message: string) {
  this.showNotification('error', title, message);
}

private showWarning(title: string, message: string) {
  this.showNotification('warning', title, message);
}

private showInfo(title: string, message: string) {
  this.showNotification('info', title, message);
}

dismissNotification(id: number) {
  this.notifications = this.notifications.filter(n => n.id !== id);
}

getNotificationIcon(type: string): string {
  switch(type) {
    case 'success': return '✅';
    case 'error': return '❌';
    case 'warning': return '⚠️';
    case 'info': return 'ℹ️';
    default: return 'ℹ️';
  }
}

// Modal helper methods
private showConfirm(title: string, message: string, confirmText: string = 'OK', cancelText: string = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    this.confirmModalData = {
      title,
      message,
      confirmText,
      cancelText,
      onConfirm: () => {
        this.closeConfirmModal();
        resolve(true);
      },
      onCancel: () => {
        this.closeConfirmModal();
        resolve(false);
      }
    };
    this.showConfirmModal = true;
  });
}

private showThreeButtonConfirm(title: string, message: string, button1Text: string, button2Text: string, button3Text: string): Promise<'button1' | 'button2' | 'button3'> {
  return new Promise((resolve) => {
    this.confirmModalData = {
      title,
      message,
      confirmText: button1Text,
      cancelText: button2Text,
      onConfirm: () => {
        this.closeConfirmModal();
        resolve('button1');
      },
      onCancel: () => {
        this.closeConfirmModal();
        resolve('button2');
      }
    };
    
    this.confirmModalData.thirdButtonText = button3Text;
    this.confirmModalData.onThirdButton = () => {
      this.closeConfirmModal();
      resolve('button3');
    };
    
    this.showConfirmModal = true;
  });
}

private showAlert(title: string, message: string, buttonText: string = 'OK'): Promise<void> {
  return new Promise((resolve) => {
    this.alertModalData = {
      title,
      message,
      buttonText,
      onClose: () => {
        this.closeAlertModal();
        resolve();
      }
    };
    this.showAlertModal = true;
  });
}

closeConfirmModal() {
  this.showConfirmModal = false;
}

closeAlertModal() {
  this.showAlertModal = false;
}

closeIpModal() {
  this.showIpModal = false;
  this.clearAllNetworkSelections();
  this.networkSearchTerm = '';
}

  isCustomFormulaEdited(): boolean {
    if (!this.customFormula.trim() || this.riskFormula.length === 0) {
      return false;
    }
    
    const defaultFormula = this.riskFormula.map(c => c.name).join(' + ');
    return this.customFormula.trim() !== defaultFormula;
  }

  getWeightedFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    const components = this.riskFormula.map(c => `${c.name}×${c.weight}`).join(' + ');
    const totalWeight = this.getTotalWeight();
    return `(${components}) ÷ ${totalWeight}`;
  }

  getMaxFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    return `MAX(${this.riskFormula.map(c => c.name).join(', ')})`;
  }

  getSumFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    return this.riskFormula.map(c => c.name).join(' + ');
  }

  getGenericFormulaExpression(): string {
    if (this.riskFormula.length === 0) return '';
    return this.riskFormula.map(c => c.name).join(' ○ ');
  }

  private updateCustomFormulaFromComponents(): void {
    if (this.riskFormula.length === 0) {
      this.customFormula = '';
      return;
    }
    
    const isDefaultFormula = !this.customFormula.trim() || 
      this.customFormula.match(/^[^+*/()^-]+(\s*\+\s*[^+*/()^-]+)*$/);
    
    if (isDefaultFormula) {
      const componentNames = this.riskFormula.map(c => c.name);
      this.customFormula = componentNames.join(' + ');
    } else {
      const existingComponents = this.getComponentNamesFromFormula();
      const newComponents = this.riskFormula
        .map(c => c.name)
        .filter(name => !existingComponents.includes(name));
      
      if (newComponents.length > 0) {
        this.customFormula += ' + ' + newComponents.join(' + ');
      }
    }
  }

  private getComponentNamesFromFormula(): string[] {
    const componentNames = this.riskFormula.map(c => c.name);
    return componentNames.filter(name => 
      this.customFormula.toLowerCase().includes(name.toLowerCase())
    );
  }

getCategoryIcon(category: string): string {
  const icons: { [key: string]: string } = {
    'security': '🔒',
    'performance': '⚡',
    'compliance': '📋',
    'business': '💼',
    'technical': '⚙️',
    'custom': '🔧'
  };
  return icons[category] || '🔧';
}

getAutoDescription(): string {
  if (!this.customComponent.category) return 'Component description...';
  const category = this.customComponent.category.charAt(0).toUpperCase() + this.customComponent.category.slice(1);
  return `${category} component for risk assessment`;
}

  getTotalWeight(): number {
    return this.riskFormula.reduce((sum, c) => sum + (c.weight || 0), 0);
  }

  getComponentCount(): number {
    return this.riskFormula.length;
  }

  getSelectedMethodDisplay(): string {
    if (this.selectedMethod === 'custom_formula') {
      return this.customFormula.trim() || 'custom formula';
    }
    return this.selectedMethod.replace('_', ' ');
  }

  // Show component statistics
  getComponentStatistics(component: RiskComponent): string {
    if (!component.statistics) return 'No statistics available';
    
    const stats = component.statistics;
    return `Avg: ${stats.avg?.toFixed(2) || 'N/A'}, Max: ${stats.max?.toFixed(2) || 'N/A'}, Min: ${stats.min?.toFixed(2) || 'N/A'}`;
  }

  // Configuration application methods - Updated to use hierarchical selector
  saveConfiguration() {
    if (this.riskFormula.length === 0) {
      this.showWarning('Configuration Error', 'Please add components to your formula first!');
      return;
    }
    
    // Initialize hierarchical networks with real data and show selector
    this.initializeHierarchicalNetworks();
    this.showIpModal = true;
  }

private getPropertyToUpdate(): string | null {
  if (this.riskFormula.length === 0) {
    return null;
  }
  
  return this.targetProperty || 'Risk Score';
}

async refreshComponents() {
  try {
    console.log('Refreshing components from config...');
    this.isLoadingComponents = true;
    
    this.riskConfigService.getAvailableComponents().subscribe({
      next: (data) => {
        this.availableComponents = data.available_components || [];
        console.log(`Refreshed ${this.availableComponents.length} components from config`);
        this.isLoadingComponents = false;
        
        this.showInfo(
          'Components Refreshed', 
          `Updated ${this.availableComponents.length} components from configuration`
        );
      },
      error: (error) => {
        console.error('Error refreshing components from config:', error);
        this.showError(
          'Refresh Failed', 
          'Failed to refresh components from configuration'
        );
        this.isLoadingComponents = false;
      }
    });
    
  } catch (error) {
    console.error('Error refreshing components:', error);
    this.isLoadingComponents = false;
  }
}

private loadComponentsFromConfig(): void {
  console.log('Loading components from config file...');
  
  this.riskConfigService.getAvailableComponents().subscribe({
    next: (data) => {
      // Ensure all components have valid values
      this.availableComponents = (data.available_components || []).map(comp => ({
        ...comp,
        id: comp.id || `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        neo4jProperty: comp.neo4jProperty || comp.name.replace(/[^a-zA-Z0-9]/g, '_'),
        weight: this.validateNumber(comp.weight, 0),
        currentValue: this.validateNumber(comp.currentValue, 0),
        maxValue: this.validateNumber(comp.maxValue, 100)
      }));
      
      console.log('Loaded components from config:', this.availableComponents.length);
      this.isLoadingComponents = false;
      
      this.showSuccess(
        'Components Loaded', 
        `Loaded ${this.availableComponents.length} components from configuration`
      );
    },
    error: (error) => {
      console.error('Error loading components from config:', error);
      this.showError(
        'Config Loading Failed', 
        'Failed to load components from configuration file'
      );
      this.isLoadingComponents = false;
    }
  });
}

  addCustomComponent() {
    this.customComponent = {
      name: '',
      category: '',
      maxValue: 10
    };
    this.showCustomComponentModal = true;
  }

  closeCustomComponentModal() {
    this.showCustomComponentModal = false;
    this.customComponent = {
      name: '',
      category: '',
      maxValue: 10
    };
  }
  
  saveCustomComponent() {
  if (!this.customComponent.name.trim()) {
    this.showWarning('Validation Error', 'Please enter a component name');
    return;
  }
  
  if (!this.customComponent.category) {
    this.showWarning('Validation Error', 'Please select a component category');
    return;
  }
  
  if (this.customComponent.maxValue < 1 || this.customComponent.maxValue > 10) {
    this.showWarning('Validation Error', 'Max value must be between 1 and 10');
    return;
  }
  
  const autoDescription = `${this.customComponent.category.charAt(0).toUpperCase() + this.customComponent.category.slice(1)} component for risk assessment`;
  
  const categoryIcons: { [key: string]: string } = {
    'security': '🔐',
    'performance': '⚡',
    'compliance': '📋',
    'business': '💼',
    'technical': '⚙️',
    'custom': '🔧'
  };
  
  // Generate the component key the same way backend does
  const componentKey = this.customComponent.name.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  
  const newComponent: RiskComponent = {
    id: Date.now(),  // Keep numeric ID for now
    name: this.customComponent.name.trim(),
    type: 'custom',
    icon: categoryIcons[this.customComponent.category] || '🔧',
    description: autoDescription,
    weight: 0.2,
    maxValue: this.customComponent.maxValue,
    currentValue: 0,
    neo4jProperty: componentKey,
    isComposite: false
  };
  
  this.riskConfigService.saveCustomComponent(newComponent).subscribe({
    next: async (response) => {
      console.log('Server response:', response);
      
      // Write to Neo4j
      await this.writeComponentToNeo4j(newComponent);
      
      const serverComponentKey = response.component_key;
      
      const componentToAdd = {
        ...newComponent,
        id: serverComponentKey,
        neo4jProperty: serverComponentKey,
        weight: this.validateNumber(newComponent.weight, 0.2),
        currentValue: this.validateNumber(newComponent.currentValue, 0),
        maxValue: this.validateNumber(newComponent.maxValue, 100)
      };
      
      this.availableComponents.push(componentToAdd);
      this.customComponents.push(componentToAdd);
      
      this.closeCustomComponentModal();
      
      this.showSuccess(
        'Component Added', 
        `"${newComponent.name}" has been saved and is ready to use`
      );
    },
    error: (error) => {
      console.error('Error saving custom component:', error);
      this.showError(
        'Save Failed', 
        'Failed to save component to configuration file'
      );
    }
  });
}

private async writeComponentToNeo4j(component: any): Promise<any> {
  const componentData = {
    componentName: component.name,
    neo4jProperty: component.neo4jProperty,
    formula: 'setValue',
    method: 'setValue',
    components: [{
      name: component.name,
      neo4jProperty: component.neo4jProperty,
      weight: component.weight,
      maxValue: component.maxValue,
      currentValue: 0
    }],
    targetType: 'all',
    targetValues: [],
    calculationMode: 'setValue'
  };

  return await this.http.post('http://localhost:3000/api/write-custom-risk-component', componentData).toPromise();
}

loadFormulas(): void {
  this.isLoadingFormulas = true;
  
  // Load predefined formulas
  this.riskConfigService.getPredefinedFormulas().subscribe({
    next: (data) => {
      this.predefinedFormulas = data.formulas;
      console.log('Loaded predefined formulas:', this.predefinedFormulas);
    },
    error: (error) => {
      console.error('Error loading predefined formulas:', error);
    }
  });

  // Load custom formulas
  this.riskConfigService.getCustomFormulas().subscribe({
    next: (data) => {
      this.customFormulas = data.formulas;
      console.log('Loaded custom formulas:', this.customFormulas);
    },
    error: (error) => {
      console.error('Error loading custom formulas:', error);
    }
  });

  // Load active formula
  this.riskConfigService.getActiveFormula().subscribe({
    next: (data) => {
      this.activeFormula = data.active_formula;
      console.log('Active formula:', this.activeFormula);
      this.isLoadingFormulas = false;
      
      this.autoLoadActiveFormula();
    },
    error: (error) => {
      console.error('Error loading active formula:', error);
      this.isLoadingFormulas = false;
    }
  });
}

loadCustomComponents() {
  this.riskConfigService.getCustomComponents().subscribe({
    next: (components) => {
      console.log('Loaded custom components:', components);
      
      this.customComponents = components.map(comp => ({
        ...comp,
        id: comp.id || comp.neo4jProperty,
        neo4jProperty: comp.neo4jProperty || comp.id
      }));
    },
    error: (error) => {
      console.error('Error loading custom components:', error);
      }
  });
}

loadFormulaFromLeftPanel(formula: RiskFormula): void {
  // Ensure components are cleared before loading
  this.resetFormula();
  
  // Load the selected formula
  this.loadPredefinedFormula(formula);
}

private autoLoadActiveFormula(): void {
  if (this.activeFormula && this.riskFormula.length === 0) {
    console.log('Auto-loading active formula:', this.activeFormula.name);
    
    // Show notification
    this.showInfo(
      'Active Formula Loaded', 
      `"${this.activeFormula.name}" has been loaded automatically`
    );
    
    // Load the formula
    this.loadPredefinedFormula(this.activeFormula);
  }
}

  setActiveFormula(formula: RiskFormula): void {
  this.riskConfigService.setActiveFormula(formula.id, formula.type).subscribe({
    next: () => {
      this.activeFormula = formula;
      console.log('Set active formula:', formula);
      
      // Clear existing formula components before loading new ones
      this.resetFormula();
      
      // Load the new formula
      this.loadPredefinedFormula(formula);
    },
    error: (error) => {
      console.error('Error setting active formula:', error);
    }
  });
}

  isActiveFormula(formula: RiskFormula): boolean {
    return this.activeFormula?.id === formula.id && this.activeFormula?.type === formula.type;
  }

  private validateNumber(value: any, defaultValue: number = 0): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

  getComponentDisplayName(componentKey: string): string {
  // First try to find in available components
  let component = this.availableComponents.find(c => c.neo4jProperty === componentKey);
  
  // If not found, try custom components
  if (!component) {
    component = this.customComponents.find(c => 
      c.neo4jProperty === componentKey || c.name === componentKey
    );
  }
  
  // If still not found, check if it's in the current formula
  if (!component) {
    component = this.riskFormula.find(c => c.neo4jProperty === componentKey);
  }
  
  // Return the display name or a formatted version of the key
  if (component) {
    return component.name;
  } else {
    // Fallback: format the key as a readable name
    console.warn(`Component not found for key: ${componentKey}`);
    return componentKey.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim().toUpperCase();
  }
}

getFormulaComponentsArray(formula: RiskFormula): Array<{key: string, value: number}> {
  if (!formula.components) return [];
  return Object.entries(formula.components).map(([key, value]) => ({key, value}));
}

isValidWeight(): boolean {
  const total = this.getTotalWeight();
  return Math.abs(total - 1.0) <= 0.01;
}

onWeightChange(): void {
  console.log('Weight changed, total:', this.getTotalWeight());
  
  if (!this.isValidWeight()) {
    console.warn('Formula weights do not sum to 1.0:', this.getTotalWeight());
  }
}

resetFormula(): void {
  // Return all formula components back to available components
  // Only add components that aren't already in available list
  this.riskFormula.forEach(component => {
    const exists = this.availableComponents.some(
      c => c.neo4jProperty === component.neo4jProperty
    );
    if (!exists) {
      // Reset weight to default before returning to available pool
      component.weight = 0;
      this.availableComponents.push(component);
    }
  });
  
  // Clear the formula array
  this.riskFormula = [];
  
  // Clear custom formula if using that method
  if (this.selectedMethod === 'custom_formula') {
    this.customFormula = '';
  }
  
  console.log('Formula reset - available components:', this.availableComponents.length);
}

trackByFn(index: number, item: RiskComponent): any {
  return item.id || item.neo4jProperty || index;
}

validateFormula(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (this.riskFormula.length === 0) {
    errors.push('Formula must contain at least one component');
  }
  
  const total = this.getTotalWeight();
  if (Math.abs(total - 1.0) > 0.01) {
    errors.push(`Component weights must sum to 1.0 (currently ${total.toFixed(3)})`);
  }
  
  // Check for duplicate components
  const componentIds = this.riskFormula.map(c => c.neo4jProperty);
  const duplicates = componentIds.filter((id, index) => componentIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    errors.push('Formula contains duplicate components');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

loadPredefinedFormula(formula: RiskFormula): void {
  // Return all current formula components to available pool
  this.availableComponents.push(...this.riskFormula);
  
  // Clear the formula array
  this.riskFormula = [];
  
  // Clear custom formula if in custom mode
  if (this.selectedMethod === 'custom_formula') {
    this.customFormula = '';
  }
  
  // Load components from the selected formula
  if (formula.components) {
    const loadedComponents: RiskComponent[] = [];
    const missingComponents: string[] = [];
    
    Object.entries(formula.components).forEach(([componentId, weight]) => {
      // Find component in available components
      const componentIndex = this.availableComponents.findIndex(
        c => c.neo4jProperty === componentId
      );
      
      if (componentIndex !== -1) {
        // Remove from available and add to formula with correct weight
        const component = this.availableComponents.splice(componentIndex, 1)[0];
        component.weight = this.validateNumber(weight, 0.2);
        loadedComponents.push(component);
      } else {
        // Component not found - create a placeholder
        console.warn(`Component ${componentId} not found - creating placeholder`);
        missingComponents.push(componentId);
        
        // Look in custom components for metadata
        const customComp = this.customComponents.find(c => 
          c.neo4jProperty === componentId || c.name === componentId
        );
        
        // Create placeholder with available metadata
        const placeholderComponent: RiskComponent = {
          id: `placeholder_${Date.now()}`,
          name: customComp?.name || componentId.replace(/_/g, ' ').toUpperCase(),
          neo4jProperty: componentId,
          weight: this.validateNumber(weight, 0.2),
          currentValue: 0,
          maxValue: customComp?.maxValue || 100,
          type: customComp?.type || 'custom',
          icon: customComp?.icon || '⚠️',
          description: customComp?.description || `Component ${componentId} (placeholder)`,
          isComposite: false
        };
        
        loadedComponents.push(placeholderComponent);
      }
    });
    
    // Set the new formula components
    this.riskFormula = loadedComponents;
    
    // Show warning if there were missing components
    if (missingComponents.length > 0) {
      this.showWarning(
        'Missing Components',
        `Some components were not found: ${missingComponents.join(', ')}. Placeholders were created.`
      );
    }
  }
  
  // Close formula selector
  this.showFormulaSelector = false;
  
  // Show success notification
  this.showSuccess(
    'Formula Loaded', 
    `Loaded "${formula.name}" with ${this.riskFormula.length} components`
  );
  
  console.log('Loaded formula into designer:', formula.name, this.riskFormula);
}

saveCurrentFormulaAsCustom(): void {
  const validation = this.validateFormula();
  if (!validation.valid) {
    this.showWarning('Formula Validation Failed', validation.errors.join('\n'));
    return;
  }

  // Open modal for formula details
  this.formulaInputModalData = {
    title: 'Save Custom Formula',
    nameLabel: 'Formula Name',
    descriptionLabel: 'Description',
    name: '',
    description: '',
    onSave: () => {
      const formulaName = this.formulaInputModalData.name.trim();
      const formulaDescription = this.formulaInputModalData.description.trim() || 'Custom formula created in designer';
      
      if (!formulaName) {
        this.showWarning('Invalid Name', 'Please enter a formula name');
        return;
      }

      // Create components object with weights
      const components: { [key: string]: number } = {};
      
      this.riskFormula.forEach(component => {
        // Debug logging
        console.log('Saving component to formula:', {
          name: component.name,
          neo4jProperty: component.neo4jProperty,
          weight: component.weight
        });
        
        const propertyKey = component.neo4jProperty || component.name.replace(/[^a-zA-Z0-9]/g, '_');
        
        if (propertyKey && propertyKey !== 'undefined') {
          components[propertyKey] = this.validateNumber(component.weight, 0.2);
        } else {
          console.error('Component missing valid neo4jProperty:', component);
          this.showWarning('Invalid Component', `Component "${component.name}" could not be saved properly`);
          return;
        }
      });
      
      if (Object.keys(components).length !== this.riskFormula.length) {
        this.showError('Save Failed', 'Some components could not be saved properly');
        return;
      }

      const customFormula = {
        name: formulaName,
        description: formulaDescription,
        components: components,
        created_by: 'user'
      };

      this.riskConfigService.createCustomFormula(customFormula).subscribe({
        next: (response) => {
          console.log('Custom formula saved:', response);
          this.showSuccess('Formula Saved', `"${formulaName}" saved successfully!`);
          this.loadFormulas(); // Reload to show the new custom formula
          this.closeFormulaInputModal();
        },
        error: (error) => {
          console.error('Error saving custom formula:', error);
          this.showError('Save Failed', 'Failed to save custom formula. Please try again.');
        }
      });
    },
    onCancel: () => {
      this.closeFormulaInputModal();
    }
  };
  
  this.showFormulaInputModal = true;
}

async deleteCustomFormula(formula: RiskFormula): Promise<void> {
  const confirmMessage = `Are you sure you want to delete "${formula.name}"?\n\nThis action cannot be undone.`;
  
  const confirmed = await this.showConfirm(
    'Delete Formula',
    confirmMessage,
    'Delete',
    'Cancel'
  );
  
  if (!confirmed) {
    return;
  }

  console.log('Deleting formula:', formula.id, formula.name);

  this.riskConfigService.deleteCustomFormula(formula.id).subscribe({
    next: (response) => {
      console.log('Delete response:', response);
      this.showSuccess(
        'Formula Deleted', 
        `"${formula.name}" has been deleted successfully`
      );
      
      // Reload formulas to refresh the list
      this.loadFormulas();
      
      // If this was the active formula, clear it from display
      if (this.isActiveFormula(formula)) {
        this.activeFormula = null;
      }
    },
    error: (error) => {
      console.error('Error deleting custom formula:', error);
      let errorMessage = 'Failed to delete custom formula';
      
      if (error.error && error.error.error) {
        errorMessage = error.error.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      this.showError('Delete Failed', errorMessage);
    }
  });
}

async deleteCustomComponent(component: any): Promise<void> {
  const confirmMessage = `Are you sure you want to delete "${component.name}"?\n\nThis will:\n• Remove the component from configuration\n• Delete the "${component.neo4jProperty}" property from all nodes in Neo4j\n\nThis action cannot be undone.`;
  
  const confirmed = await this.showConfirm(
    'Delete Component',
    confirmMessage,
    'Delete',
    'Cancel'
  );
  
  if (!confirmed) {
    return;
  }

  const componentId = component.id;
  console.log('Deleting component:', componentId, component.name);

  this.riskConfigService.deleteCustomComponent(componentId).subscribe({
    next: async (response) => {
      console.log('Delete response:', response);
      
      // Call the Neo4j property deletion endpoint
      try {
        const neo4jResponse = await this.http.delete(`http://localhost:5000/api/components/neo4j-property/${component.neo4jProperty}`).toPromise();
        console.log('Neo4j deletion response:', neo4jResponse);
      } catch (neo4jError) {
        console.error('Error deleting from Neo4j:', neo4jError);
        this.showWarning('Partial Deletion', 'Component removed from config but Neo4j cleanup failed');
      }
      
      await this.riskComponentsService.initializeComponentsInNeo4j();
      
      this.showSuccess(
        'Component Deleted', 
        `"${component.name}" has been deleted successfully from both config and Neo4j`
      );
      
      this.loadCustomComponents();
      
      this.availableComponents = this.availableComponents.filter(
        c => c.id !== componentId
      );
      
      this.customComponents = this.customComponents.filter(
        c => c.id !== componentId
      );
    },
    error: (error) => {
      console.error('Error deleting custom component:', error);
      let errorMessage = 'Failed to delete custom component';
      
      if (error.error && error.error.error) {
        errorMessage = error.error.error;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      this.showError('Delete Failed', errorMessage);
    }
  });
}

closeFormulaInputModal() {
  this.showFormulaInputModal = false;
  // Reset form data
  this.formulaInputModalData.name = '';
  this.formulaInputModalData.description = '';
}

  private prepareComponentData(): ComponentData[] {
    return this.riskFormula.map(comp => ({
      name: comp.name,
      weight: comp.weight,
      currentValue: comp.currentValue || 0,
      maxValue: comp.maxValue || 10,
      neo4jProperty: comp.neo4jProperty || comp.name.toLowerCase().replace(/ /g, '_')
    }));
  }

}