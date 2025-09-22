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

  showIpModal = false;
  availableIpAddresses: any[] = [];
  filteredIpAddresses: any[] = [];
  selectedIps: boolean[] = [];
  selectAllIps = false;
  ipSearchTerm = '';
  subnetSearchTerm: string = '';
  filteredSubnets: any[] = [];

  selectedSubnetForIps: string = '';

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
  // showCalculationModeModal = false;
  showFrequencyModal = false;
  // private calculationModeCallback: ((mode: string | null) => void) | null = null;
  // selectedCalculationMode: 'setValue' | 'calculate' | null = null;
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

  // Modal states
  showConfigModal = false;
  showNetworkModal = false;
  showSubnetModal = false;
  
  availableNetworks: any[] = [];
  availableSubnets: any[] = [];

  // Multi-select network properties
  selectedNetworks: boolean[] = [];
  selectAllNetworks = false;

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
  
  // Load formulas after components are loaded
  setTimeout(() => {
    this.loadFormulas();
  }, 500);
  
}

openIpModalForSubnet(subnet?: string) {
  this.selectedSubnetForIps = subnet || '';
  this.loadIpAddressesFromSubnet(this.selectedSubnetForIps);
  this.showIpModal = true;
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
            enabled: response.automations[key].enabled !== false, // Handle missing enabled field
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
        // Update the local automation object
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
        // Update the local automation object
        automation.enabled = true;
        this.showSuccess('Automation Resumed', `${this.getComponentName(automation)} automation has been resumed`);
      },
      error: (error) => {
        this.showError('Resume Failed', error.error?.message || 'Failed to resume automation');
      }
    });
}

getAutomationStatusText(automation: ActiveAutomation): string {
  // Check if enabled property exists, if not default to true, if explicitly false then paused
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
  // Get the actual target values from the automation data
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
  // Handle both component and formula automations
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
  if (!frequency) return 'Manual'; // Handle undefined/null/empty cases
  
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
  
  private async loadNetworkData() {
  console.log('Loading network data...');
  const currentData = this.networkDataService.getCurrentNetworkData();
  
  // Store all subnets without limit
  this.availableSubnets = currentData;
  this.filteredSubnets = currentData; // Initialize filtered subnets
  
  const networkMap = new Map();
  
  currentData.forEach(subnet => {
    const networkPrefix = subnet.subnet.split('.').slice(0, 2).join('.');
    if (!networkMap.has(networkPrefix)) {
      networkMap.set(networkPrefix, {
        prefix: networkPrefix,
        subnets: [],
        totalDevices: 0
      });
    }
    const network = networkMap.get(networkPrefix);
    network.subnets.push(subnet);
    network.totalDevices += subnet.deviceCount;
  });

  this.availableNetworks = Array.from(networkMap.values());
  this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
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

  private async loadIpAddresses() {
  console.log('Loading IP addresses...');
  this.availableIpAddresses = [];
  
  try {
    const networkData = this.networkDataService.getCurrentNetworkData();
    console.log('Network data:', networkData.length, 'subnets');
    
    // Only process subnets that have devices loaded (hasDetailedData = true)
    const subnetsWithDevices = networkData.filter(subnet => 
      subnet.hasDetailedData && subnet.devices && subnet.devices.length > 0
    );
    
    console.log(`Found ${subnetsWithDevices.length} subnets with loaded devices`);
    
    if (subnetsWithDevices.length === 0) {
      console.log('No subnets with loaded device data found');
      this.filteredIpAddresses = [];
      return;
    }
    
    // Extract all devices from subnets that have been loaded
    subnetsWithDevices.forEach(subnet => {
      subnet.devices.forEach(device => {
        if (device.ip) {
          this.availableIpAddresses.push({
            ip: device.ip,
            subnet: subnet.subnet,
            riskScore: device.riskScore || 0,
            hostname: device.hostname || 'Unknown',
            deviceData: device
          });
        }
      });
    });
    
    // Sort by IP address
    this.availableIpAddresses.sort((a, b) => {
      const aOctets = a.ip.split('.').map(Number);
      const bOctets = b.ip.split('.').map(Number);
      for (let i = 0; i < 4; i++) {
        if (aOctets[i] !== bOctets[i]) {
          return aOctets[i] - bOctets[i];
        }
      }
      return 0;
    });
    
    // Initialize with all available IPs (no 50 limit)
    this.filteredIpAddresses = [...this.availableIpAddresses];
    this.selectedIps = new Array(this.availableIpAddresses.length).fill(false);
    this.selectAllIps = false;
    this.ipSearchTerm = '';
    
    console.log(`Loaded ${this.availableIpAddresses.length} IP addresses from expanded subnets`);
    
  } catch (error) {
    console.error('Error loading IP addresses:', error);
    this.availableIpAddresses = [];
    this.filteredIpAddresses = [];
  }
}

  private loadIpAddressesFromSubnet(selectedSubnet?: string) {
  if (!selectedSubnet) {
    this.availableIpAddresses = [];
    this.filteredIpAddresses = [];
    return;
  }

  try {
    const networkData = this.networkDataService.getCurrentNetworkData();
    console.log('Network data:', networkData.length, 'subnets');
    
    this.availableIpAddresses = [];
    
    // Find the specific subnet or load from clicked subnet
    const subnetsToProcess = selectedSubnet ? 
      networkData.filter(subnet => subnet.subnet === selectedSubnet) : 
      networkData;
    
    subnetsToProcess.forEach(subnet => {
      if (subnet.devices && subnet.devices.length > 0) {
        subnet.devices.forEach(device => {
          if (device.ip) {
            this.availableIpAddresses.push({
              ip: device.ip,
              subnet: subnet.subnet,
              riskScore: device.riskScore || 0,
              hostname: device.hostname || 'Unknown',
              deviceData: device
            });
          }
        });
      } else {
        // Generate sample IPs from subnet range for demonstration
        const baseIp = subnet.subnet.split('/')[0];
        const baseOctets = baseIp.split('.');
        
        const ipCount = Math.min(5, Math.max(3, subnet.deviceCount || 3));
        for (let i = 1; i <= ipCount; i++) {
          const lastOctet = Math.floor(Math.random() * 200) + 10;
          const sampleIp = `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.${lastOctet}`;
          
          this.availableIpAddresses.push({
            ip: sampleIp,
            subnet: subnet.subnet,
            riskScore: subnet.riskScore || 0,
            hostname: `host-${lastOctet}`,
            deviceData: null
          });
        }
      }
    });
    
    // Sort by IP address
    this.availableIpAddresses.sort((a, b) => {
      const aOctets = a.ip.split('.').map(Number);
      const bOctets = b.ip.split('.').map(Number);
      
      for (let i = 0; i < 4; i++) {
        if (aOctets[i] !== bOctets[i]) {
          return aOctets[i] - bOctets[i];
        }
      }
      return 0;
    });
    
    // Initialize filtered list with all IPs
    this.filteredIpAddresses = [...this.availableIpAddresses];
    this.selectedIps = new Array(this.filteredIpAddresses.length).fill(false);
    
  } catch (error) {
    console.error('Error loading IP addresses:', error);
    this.availableIpAddresses = [];
    this.filteredIpAddresses = [];
  }
}

getExpandedSubnetsCount(): number {
  return this.networkDataService.getCurrentNetworkData().filter(s => s.hasDetailedData).length;
}

//  private async askCalculationMode(): Promise<'setValue' | 'calculate' | null> {
//   return new Promise((resolve) => {
//     const result = this.showThreeButtonConfirm(
//       'Choose Calculation Mode',
//       'How should the risk calculation be performed?',
//       'Set Specific Values (Use configured values)',
//       'Calculate from Properties (Use existing Neo4j values)',
//       'Cancel'
//     ).then((buttonResult) => {
//       if (buttonResult === 'button1') {
//         resolve('setValue');
//       } else if (buttonResult === 'button2') {
//         resolve('calculate');
//       } else {
//         resolve(null);
//       }
//     });
//   });
// }

  // selectCalculationMode(mode: string | null) {
  //   this.selectedCalculationMode = mode as 'setValue' | 'calculate' | null;
  //   if (this.calculationModeCallback) {
  //     this.calculationModeCallback(mode);
  //   }
  // }

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
    this.frequencyResolve(frequency);  // Resolve with the selected frequency
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

filterIpAddresses() {
  if (!this.ipSearchTerm.trim()) {
    this.filteredIpAddresses = [...this.availableIpAddresses];
  } else {
    const searchTerm = this.ipSearchTerm.toLowerCase();
    this.filteredIpAddresses = this.availableIpAddresses.filter(ip => 
      ip.ip.includes(searchTerm) || 
      ip.hostname.toLowerCase().includes(searchTerm) ||
      ip.subnet.includes(searchTerm)
    );
  }
  
  // Reset selections when filtering
  this.selectedIps = new Array(this.filteredIpAddresses.length).fill(false);
  this.selectAllIps = false;
}

toggleAllIps(event: any) {
  const selectAll = event.target.checked;
  this.selectedIps = new Array(this.filteredIpAddresses.length).fill(selectAll);
  this.selectAllIps = selectAll;
}

updateIpSelection() {
  const selectedCount = this.getSelectedIpsCount();
  const totalCount = this.filteredIpAddresses.length;
  
  if (selectedCount === 0) {
    this.selectAllIps = false;
  } else if (selectedCount === totalCount) {
    this.selectAllIps = true;
  } else {
    this.selectAllIps = false;
  }
}

isSelectAllIpsIndeterminate(): boolean {
  const selectedCount = this.getSelectedIpsCount();
  const totalCount = this.filteredIpAddresses.length;
  return selectedCount > 0 && selectedCount < totalCount;
}

getSelectedIpsCount(): number {
  return this.selectedIps.filter(selected => selected).length;
}

getSelectedIpsCountText(): string {
  const count = this.getSelectedIpsCount();
  if (count === 0) {
    return '0 IPs selected';
  } else if (count === 1) {
    return '1 IP selected';
  } else {
    return `${count} IPs selected`;
  }
}

closeIpModal() {
  this.showIpModal = false;
  this.selectedIps = [];
  this.ipSearchTerm = '';
  this.selectAllIps = false;
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

  // Configuration application methods
saveConfiguration() {
  if (this.riskFormula.length === 0) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  // Show the configuration modal instead of immediate save
  this.showConfigModal = true;
}

async applyConfiguration() {
    if (this.riskFormula.length === 0) {
      this.showWarning('Configuration Error', 'Please add components to your formula first');
      return;
    }
    
    // Show the apply options modal
    this.showConfigModal = true;
  }

async applyToNetwork() {
    if (this.riskFormula.length === 0) {
      this.showWarning('Configuration Error', 'Please add components to your formula first');
      return;
    }

    // Show network selection modal
    this.showNetworkModal = true;
  }

async applyToSelectedNetworks() {
  const selectedNetworkIndices = this.selectedNetworks
    .map((selected, index) => selected ? index : -1)
    .filter(index => index !== -1);
  
  if (selectedNetworkIndices.length === 0) {
    this.showWarning('Selection Required', 'Please select at least one network to apply the configuration.');
    return;
  }
  
  const selectedNetworkData = selectedNetworkIndices.map(index => this.availableNetworks[index]);
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  this.closeNetworkModal();
  
  const calculationMode = 'calculate';
  
  const networkNames = selectedNetworkData.map(n => n.prefix + '.x.x').join(', ');
  const confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values in selected networks?\n\nNetworks: ${networkNames}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use property values from Node objects. Continue?`;
  
  const confirmed = await this.showConfirm(
    'Apply Risk Calculation',
    confirmMessage,
    'Continue',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  const updateFrequency = await this.askUpdateFrequency();
  if (!updateFrequency) return;
  
  const selectedPrefixes = selectedNetworkData.map(n => n.prefix);
  
  const config: RiskConfigurationRequest = {
    formulaName: this.currentFormulaName || 'Custom Formula',
    components: this.prepareComponentData(),
    targetType: 'network',
    targetValues: selectedPrefixes,
    calculationMode: calculationMode,
    calculationMethod: this.selectedMethod,
    customFormula: this.customFormula,
    updateFrequency: updateFrequency,
    targetProperty: this.targetProperty || 'Risk Score'
  };

  try {
    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied',
        `Updated ${response.nodesUpdated} nodes with average risk score: ${response.avgRiskScore.toFixed(2)}`
      );
      
      if (response.automationEnabled) {
        this.showInfo('Automation Enabled', `Risk calculation will run ${updateFrequency}`);
      }
      
      // Clear the formula after successful save
      this.riskFormula = [];
    }
    
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying configuration:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Application Failed', `Failed to apply risk configuration: ${errorMessage}`);
  }
}

async applyToSubnet(subnet: any) {
  this.closeSubnetModal();
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  const calculationMode = 'calculate';
  
  const confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values in subnet ${subnet.subnet}?\n\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use property values from Node objects. Continue?`;
  
  const confirmed = await this.showConfirm(
    'Apply to Subnet',
    confirmMessage,
    'Continue',
    'Cancel'
  );
  
  if (!confirmed) return;
  
  const updateFrequency = await this.askUpdateFrequency();
  if (!updateFrequency) return;
  
  const config: RiskConfigurationRequest = {
    formulaName: this.currentFormulaName || 'Custom Formula',
    components: this.prepareComponentData(),
    targetType: 'subnet',
    targetValues: [subnet.subnet],
    calculationMode: calculationMode,
    calculationMethod: this.selectedMethod,
    customFormula: this.customFormula,
    updateFrequency: updateFrequency,
    targetProperty: this.targetProperty || 'Risk Score'
  };

  try {
    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied',
        `Updated ${response.nodesUpdated} nodes with average risk score: ${response.avgRiskScore.toFixed(2)}`
      );
      
      if (response.automationEnabled) {
        this.showInfo('Automation Enabled', `Risk calculation will run ${updateFrequency}`);
      }
      
      // Clear the formula after successful save
      this.riskFormula = [];
    }
    
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying configuration:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Application Failed', `Failed to apply risk configuration: ${errorMessage}`);
  }
}

async applyToSelectedIps() {
  const selectedIpIndices = this.selectedIps
    .map((selected, index) => selected ? index : -1)
    .filter(index => index !== -1);
  
  if (selectedIpIndices.length === 0) {
    this.showWarning('Selection Required', 'Please select at least one IP address.');
    return;
  }
  
  const selectedIpData = selectedIpIndices.map(index => this.filteredIpAddresses[index]);
  
  const propertyToUpdate = this.getPropertyToUpdate();
  if (!propertyToUpdate) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  this.closeIpModal();
  
  const calculationMode = 'calculate';
  
  const ipAddresses = selectedIpData.map(ip => ip.ip).join(', ');
  const displayIps = ipAddresses.length > 100 ? ipAddresses.substring(0, 100) + '...' : ipAddresses;
  const confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values for selected IPs?\n\nIPs: ${displayIps}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use property values from Node objects. Continue?`;
  
  const confirmed = await this.showConfirm(
    'Apply to IP Addresses',
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
      targetType: 'ip',
      targetValues: selectedIpData.map(ip => ip.ip),
      calculationMode: calculationMode,
      calculationMethod: this.selectedMethod,
      customFormula: this.customFormula,
      updateFrequency: frequency,
      targetProperty: this.targetProperty || 'Risk Score'
    };

    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied', 
        `Updated ${response.nodesUpdated} nodes for ${selectedIpData.length} IP addresses\nAverage Risk Score: ${response.avgRiskScore.toFixed(2)}`
      );
      
      if (response.automationEnabled) {
        this.showInfo('Automation Enabled', `Risk calculation will run ${frequency}`);
      }
      
      // Clear the formula after successful save
      this.riskFormula = [];
    }
    
    this.selectedIps = [];
    this.selectAllIps = false;
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying to IPs:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Update Failed', `Error updating Node property:\n\n${errorMessage}`);
  }
}

private getPropertyToUpdate(): string | null {
  if (this.riskFormula.length === 0) {
    return null;
  }
  
  return this.targetProperty || 'Risk Score';
}

async testConfiguration() {
  if (this.riskFormula.length === 0) {
    this.showWarning('Configuration Error', 'Please add components to your formula first!');
    return;
  }
  
  const testResult = this.calculatePreviewRisk();
  const riskLevel = testResult >= 8 ? 'Critical' : testResult >= 6 ? 'High' : testResult >= 4 ? 'Medium' : 'Low';
  
  const componentInfo = this.riskFormula.map(comp => {
    const value = comp.currentValue || comp.statistics?.avg || 0;
    return `${comp.name}: ${value.toFixed(2)} (ISIM: ${comp.neo4jProperty})`;
  }).join('\n');
  
  const writeToDb = confirm(`Test Results using ISIM Data:\n\nSample Risk Score: ${testResult.toFixed(2)}\nRisk Level: ${riskLevel}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nComponent Values:\n${componentInfo}\n\nDo you want to write this as a test component to ISIM?`);
  
  if (writeToDb) {
    const testPropertyName = prompt('Enter a test property name:', 'testRiskFormula');
    if (!testPropertyName) return;
    
    const cleanTestName = testPropertyName.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    
    try {
      const result = await this.riskComponentsService.writeCustomComponent(
        'Test Formula',
        cleanTestName,
        this.customFormula || this.getSumFormulaExpression(),
        this.selectedMethod,
        this.riskFormula,
        'all',
        []
      );
      
      this.showSuccess('Test Component Created', `Test component written to ISIM!\n\nProperty: ${result.results.neo4jProperty}\nUpdated Nodes: ${result.results.updatedNodes}\nAverage Value: ${result.results.avgValue}\n\nYou can now see the "${cleanTestName}" property in your ISIM browser.`);
      
    } catch (error) {
      console.error('Error writing test component:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.showError('Test Failed', `Error writing test component: ${errorMessage}`);
    }
  }
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
    neo4jProperty: componentKey,  // Use the generated key
    isComposite: false
  };
  
  this.riskConfigService.saveCustomComponent(newComponent).subscribe({
    next: async (response) => {
      console.log('Server response:', response);
      
      // Write to Neo4j
      await this.writeComponentToNeo4j(newComponent);
      
      // IMPORTANT: Update the component with the backend's component_key
      const serverComponentKey = response.component_key;
      
      const componentToAdd = {
        ...newComponent,
        id: serverComponentKey,  // Use the backend's component_key as ID
        neo4jProperty: serverComponentKey,  // Ensure consistency
        weight: this.validateNumber(newComponent.weight, 0.2),
        currentValue: this.validateNumber(newComponent.currentValue, 0),
        maxValue: this.validateNumber(newComponent.maxValue, 100)
      };
      
      // Add to available components
      this.availableComponents.push(componentToAdd);
      
      // Also add to custom components list if you maintain one
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
  // Use the existing API to write to Neo4j
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

  // Network selection methods
  toggleAllNetworks(event: any) {
    const selectAll = event.target.checked;
    this.selectedNetworks = new Array(this.availableNetworks.length).fill(selectAll);
    this.selectAllNetworks = selectAll;
  }

  updateNetworkSelection() {
    const selectedCount = this.getSelectedNetworksCount();
    const totalCount = this.availableNetworks.length;
    
    if (selectedCount === 0) {
      this.selectAllNetworks = false;
    } else if (selectedCount === totalCount) {
      this.selectAllNetworks = true;
    } else {
      this.selectAllNetworks = false;
    }
  }

  isSelectAllIndeterminate(): boolean {
    const selectedCount = this.getSelectedNetworksCount();
    const totalCount = this.availableNetworks.length;
    return selectedCount > 0 && selectedCount < totalCount;
  }

  getSelectedNetworksCount(): number {
    return this.selectedNetworks.filter(selected => selected).length;
  }

  getSelectionCountText(): string {
    const count = this.getSelectedNetworksCount();
    if (count === 0) {
      return '0 networks selected';
    } else if (count === 1) {
      return '1 network selected';
    } else {
      return `${count} networks selected`;
    }
  }

  // Modal methods
  closeConfigModal() {
    this.showConfigModal = false;
  }

  closeNetworkModal() {
    this.showNetworkModal = false;
    this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
    this.selectAllNetworks = false;
  }

  closeSubnetModal() {
    this.showSubnetModal = false;
  }
  
  selectApplyOption(option: string) {
  this.closeConfigModal();
  
  switch(option) {
    case 'network':
      this.showNetworkModal = true;
      break;
    case 'subnet':
      this.showSubnetModal = true;
      break;
    case 'ip':
      this.loadIpAddresses();
      this.showIpModal = true;
      break;
  }
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
      
      // Map the components with correct IDs
      this.customComponents = components.map(comp => ({
        ...comp,
        id: comp.id || comp.neo4jProperty,  // Use the id from backend
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

async confirmNetworkApplication() {
  const selectedNetworks = this.availableNetworks
    .filter((_, index) => this.selectedNetworks[index])
    .map(network => network.prefix);

  if (selectedNetworks.length === 0) {
    this.showWarning('Selection Error', 'Please select at least one network');
    return;
  }

  const calculationMode = 'calculate';
  
  const propertyToUpdate = this.getPropertyToUpdate();
  const networkNames = selectedNetworks.map(n => n + '.x.x').join(', ');
  const confirmMessage = `Calculate "${propertyToUpdate}" using existing Node property values in selected networks?\n\nNetworks: ${networkNames}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nThis will use property values from Node objects. Continue?`;
  
  // Show confirmation
  const confirmed = await this.showConfirm(
    'Apply Configuration',
    confirmMessage,
    'Continue',
    'Cancel'
  );
  
  if (!confirmed) return;

  // Ask for update frequency
  const updateFrequency = await this.askUpdateFrequency();
  if (!updateFrequency) return;

  const config: RiskConfigurationRequest = {
    formulaName: this.currentFormulaName || 'Custom Formula',
    components: this.prepareComponentData(),
    targetType: 'network',
    targetValues: selectedNetworks,
    calculationMode: calculationMode,
    calculationMethod: this.selectedMethod,
    customFormula: this.customFormula,
    updateFrequency: updateFrequency,
    targetProperty: this.targetProperty || 'Risk Score'
  };

  try {
    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied',
        `Updated ${response.nodesUpdated} nodes with average risk score: ${response.avgRiskScore.toFixed(2)}`
      );
      
      if (response.automationEnabled) {
        this.showInfo('Automation Enabled', `Risk calculation will run ${updateFrequency}`);
      }
    }
    
    this.closeNetworkModal();
    await this.refreshComponents();
    
  } catch (error) {
    console.error('Error applying configuration:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.showError('Application Failed', `Failed to apply risk configuration: ${errorMessage}`);
  }
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

  async confirmSubnetApplication() {
  // Get selected subnets
  const selectedSubnets = this.selectedSubnets
    .map(subnet => subnet.subnet);

  if (selectedSubnets.length === 0) {
    this.showWarning('Selection Error', 'Please select at least one subnet');
    return;
  }

  const calculationMode = 'calculate';

  const frequency = await this.askUpdateFrequency();
  if (!frequency) return;

  const config: RiskConfigurationRequest = {
    formulaName: this.currentFormulaName || 'Custom Formula',
    components: this.prepareComponentData(),
    targetType: 'subnet',
    targetValues: selectedSubnets,
    calculationMode: calculationMode,
    calculationMethod: this.selectedMethod,
    customFormula: this.customFormula,
    updateFrequency: frequency,
    targetProperty: this.targetProperty || 'Risk Score'
  };

  try {
    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied',
        `Updated ${response.nodesUpdated} nodes with average risk score: ${response.avgRiskScore.toFixed(2)}`
      );
    }
    
    this.showSubnetModal = false;
  } catch (error) {
    console.error('Error applying configuration:', error);
    this.showError('Application Failed', 'Failed to apply risk configuration');
  }
}

  async applyToAll() {
  if (this.riskFormula.length === 0) {
    this.showWarning('Configuration Error', 'Please add components to your formula first');
    return;
  }

  const confirmed = await this.showConfirm(
    'Apply to All Nodes',
    'This will apply the risk calculation to ALL nodes in the network. Continue?'
  );

  if (!confirmed) return;

  const calculationMode = 'calculate';

  const frequency = await this.askUpdateFrequency();
  if (!frequency) return;

  const config: RiskConfigurationRequest = {
    formulaName: this.currentFormulaName || 'Custom Formula',
    components: this.prepareComponentData(),
    targetType: 'all',
    targetValues: [],
    calculationMode: calculationMode,
    calculationMethod: this.selectedMethod,
    customFormula: this.customFormula,
    updateFrequency: frequency,
    targetProperty: this.targetProperty || 'Risk Score'
  };

  try {
    const response = await this.riskConfigService.applyRiskConfiguration(config).toPromise();
    
    if (response?.success) {
      this.showSuccess(
        'Configuration Applied',
        `Updated ${response.nodesUpdated} nodes with average risk score: ${response.avgRiskScore.toFixed(2)}`
      );
      
      if (response.automationEnabled) {
        this.showInfo('Automation Enabled', `Risk calculation will run ${frequency}`);
      }
    }
  } catch (error) {
    console.error('Error applying configuration:', error);
    this.showError('Application Failed', 'Failed to apply risk configuration');
  }
}

}