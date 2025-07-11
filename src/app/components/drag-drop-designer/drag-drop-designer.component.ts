import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { NetworkDataService } from '../../services/network-data.service';

interface RiskComponent {
  id: number;
  name: string;
  type: string;
  icon: string;
  description: string;
  weight: number;
  maxValue: number;
  mockValue?: number;
}

interface CalculationMethod {
  id: string;
  name: string;
  type: string;
  icon: string;
  description: string;
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
  availableComponents: RiskComponent[] = [
    { id: 1, name: 'Criticality Score', type: 'metric', icon: '🎯', description: 'Asset criticality rating', weight: 0.3, maxValue: 10 },
    { id: 2, name: 'Threat Score', type: 'metric', icon: '⚠️', description: 'Current threat level', weight: 0.3, maxValue: 10 },
    { id: 3, name: 'CVSS Score', type: 'vulnerability', icon: '🔓', description: 'Vulnerability severity', weight: 0.4, maxValue: 10 },
    { id: 4, name: 'Wazuh Score', type: 'custom', icon: '🛡️', description: 'Wazuh threat detection', weight: 0.2, maxValue: 10 },
    { id: 5, name: 'Exposure Score', type: 'metric', icon: '🌐', description: 'Network exposure level', weight: 0.2, maxValue: 10 },
    { id: 6, name: 'Compliance Score', type: 'compliance', icon: '📋', description: 'Regulatory compliance', weight: 0.1, maxValue: 10 },
    { id: 7, name: 'Asset Value', type: 'business', icon: '💰', description: 'Business asset value', weight: 0.3, maxValue: 10 },
    { id: 8, name: 'Patch Level', type: 'maintenance', icon: '🔧', description: 'System patch status', weight: 0.2, maxValue: 10 }
  ];

  // Calculation methods
  availableMethods: CalculationMethod[] = [
    { id: 'weighted_avg', name: 'Weighted Average', type: 'calculation', icon: '⚖️', description: 'Components * weights / total weights' },
    { id: 'max', name: 'Maximum Score', type: 'calculation', icon: '📈', description: 'Highest component score' },
    { id: 'sum', name: 'Sum Total', type: 'calculation', icon: '➕', description: 'Add all component scores' },
    { id: 'geometric_mean', name: 'Geometric Mean', type: 'calculation', icon: '🔢', description: 'nth root of product' },
    { id: 'custom_formula', name: 'Custom Formula', type: 'calculation', icon: '🧮', description: 'User-defined calculation' }
  ];

  // Current risk formula being built
  riskFormula: RiskComponent[] = [];
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
    description: '',
    maxValue: 10
  };

  constructor(private networkDataService: NetworkDataService) {}

  ngOnInit() {
    this.availableComponents.forEach(comp => {
      comp.mockValue = Math.random() * comp.maxValue;
      comp.weight = comp.weight || 0;
    });

    // Get current network data for apply functionality
    this.loadNetworkData();
  }
  
  private loadNetworkData() {
  const currentData = this.networkDataService.getCurrentNetworkData();
  
  // Extract unique networks
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
  this.availableSubnets = currentData.slice(0, 20);
  
  // Initialize selection arrays
  this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
}

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

applyToSelectedNetworks() {
  const selectedNetworkIndices = this.selectedNetworks
    .map((selected, index) => selected ? index : -1)
    .filter(index => index !== -1);
  
  if (selectedNetworkIndices.length === 0) {
    alert('Please select at least one network to apply the configuration.');
    return;
  }
  
  this.closeNetworkModal();
  
  const selectedNetworkData = selectedNetworkIndices.map(index => this.availableNetworks[index]);
  const totalSubnets = selectedNetworkData.reduce((sum, network) => sum + network.subnets.length, 0);
  const totalDevices = selectedNetworkData.reduce((sum, network) => sum + network.totalDevices, 0);
  
  console.log(`🌐 Would apply configuration to ${selectedNetworkData.length} networks`);
  selectedNetworkData.forEach(network => {
    console.log(`- ${network.prefix}.x.x: ${network.subnets.length} subnets, ${network.totalDevices} devices`);
  });
  
  // Show success message with details
  const networkNames = selectedNetworkData.map(n => n.prefix + '.x.x').join(', ');
  const message = `✅ Configuration prepared for ${selectedNetworkData.length} network${selectedNetworkData.length > 1 ? 's' : ''}!\n\nNetworks: ${networkNames}\n\nThis would affect:\n- ${totalSubnets} subnets\n- ${totalDevices} devices\n\nNote: Implementation pending backend integration.`;
  
  alert(message);
  
  // Reset selections
  this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
  this.selectAllNetworks = false;
}

// Update the existing closeNetworkModal method to reset selections
closeNetworkModal() {
  this.showNetworkModal = false;
  // Reset selections when closing
  this.selectedNetworks = new Array(this.availableNetworks.length).fill(false);
  this.selectAllNetworks = false;
}

  drop(event: CdkDragDrop<RiskComponent[]>) {
  if (event.previousContainer === event.container) {
    moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
  } else {
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
  const newWeight = parseFloat((event.target as HTMLInputElement).value);
  component.weight = newWeight;
}

updateMaxValue(component: RiskComponent, event: any) {
  const newMaxValue = parseFloat((event.target as HTMLInputElement).value);
  component.maxValue = newMaxValue;
  // Ensure current value doesn't exceed new max value
  if (component.mockValue && component.mockValue > newMaxValue) {
    component.mockValue = newMaxValue;
  }
}

updateCurrentValue(component: RiskComponent, event: any) {
  const newCurrentValue = parseFloat((event.target as HTMLInputElement).value);
  component.mockValue = Math.min(newCurrentValue, component.maxValue);
}

  // Simulate risk calculation preview
  calculatePreviewRisk(): number {
    if (this.riskFormula.length === 0) return 0;

    switch (this.selectedMethod) {
      case 'weighted_avg':
        const totalWeighted = this.riskFormula.reduce((sum, comp) => sum + ((comp.mockValue || 0) * comp.weight), 0);
        const totalWeights = this.riskFormula.reduce((sum, comp) => sum + comp.weight, 0);
        return totalWeights > 0 ? totalWeighted / totalWeights : 0;
      
      case 'max':
        return Math.max(...this.riskFormula.map(comp => comp.mockValue || 0));
      
      case 'sum':
        return this.riskFormula.reduce((sum, comp) => sum + (comp.mockValue || 0), 0);

      case 'custom_formula':
  if (!this.customFormula.trim()) {
    return 0;
  }
  
  try {
    let formulaToEvaluate = this.customFormula;
    
    // Replace component names with their mock values
    this.riskFormula.forEach(comp => {
      const regex = new RegExp(comp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      formulaToEvaluate = formulaToEvaluate.replace(regex, (comp.mockValue || 0).toFixed(2));
    });
    
    const result = this.evaluateSimpleExpression(formulaToEvaluate);
    return Math.max(0, Math.min(result, 10));
  } catch (error) {
    // If evaluation fails, fall back to weighted average
    const totalWeighted = this.riskFormula.reduce((sum, comp) => sum + ((comp.mockValue || 0) * (comp.weight || 0.2)), 0);
    return Math.min(totalWeighted, 10);
  }

      case 'geometric_mean':
        const product = this.riskFormula.reduce((prod, comp) => prod * (comp.mockValue || 1), 1);
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

  // Helper methods for template
  isCustomFormulaEdited(): boolean {
    if (!this.customFormula.trim() || this.riskFormula.length === 0) {
      return false;
    }
    
    // Check if formula is just the default "A + B + C" pattern
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
  
  // Check if formula is empty or just contains the default pattern
  const isDefaultFormula = !this.customFormula.trim() || 
    this.customFormula.match(/^[^+*/()^-]+(\s*\+\s*[^+*/()^-]+)*$/);
  
  if (isDefaultFormula) {
    // Only auto-generate if it's empty or still in default format
    const componentNames = this.riskFormula.map(c => c.name);
    this.customFormula = componentNames.join(' + ');
  } else {
    // User has custom edits, just append new components
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

insertOperator(operator: string): void {
  const textarea = document.getElementById('customFormulaField') as HTMLTextAreaElement;
  if (textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = this.customFormula;
    
    this.customFormula = text.substring(0, start) + operator + text.substring(end);
    
    // Set cursor position after the inserted operator
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + operator.length;
      textarea.focus();
    }, 0);
  } else {
    // Fallback if textarea not found
    this.customFormula += operator;
  }
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

  // Configuration application methods
  saveConfiguration() {
    if (this.riskFormula.length === 0) {
      alert('Please add components to your formula first!');
      return;
    }
    this.showConfigModal = true;
  }

  testConfiguration() {
    if (this.riskFormula.length === 0) {
      alert('Please add components to your formula first!');
      return;
    }
    
    const testResult = this.calculatePreviewRisk();
    const riskLevel = testResult >= 8 ? 'Critical' : testResult >= 6 ? 'High' : testResult >= 4 ? 'Medium' : 'Low';
    
    alert(`Test Results:\n\nSample Risk Score: ${testResult.toFixed(2)}\nRisk Level: ${riskLevel}\nMethod: ${this.selectedMethod.replace('_', ' ')}\nComponents: ${this.riskFormula.length}\n\nNote: This is a preview with mock data. Use "Save Configuration" to prepare for implementation.`);
  }

  addCustomComponent() {
  // Reset the form and show modal
  this.customComponent = {
    name: '',
    description: '',
    maxValue: 10
  };
  this.showCustomComponentModal = true;
}

closeCustomComponentModal() {
  this.showCustomComponentModal = false;
  this.customComponent = {
    name: '',
    description: '',
    maxValue: 10
  };
}

saveCustomComponent() {
  // Validate inputs
  if (!this.customComponent.name.trim()) {
    alert('Please enter a component name');
    return;
  }
  
  if (!this.customComponent.description.trim()) {
    alert('Please enter a component description');
    return;
  }
  
  if (this.customComponent.maxValue < 1 || this.customComponent.maxValue > 10) {
    alert('Max value must be between 1 and 10');
    return;
  }
  
  const newComponent: RiskComponent = {
    id: Date.now(),
    name: this.customComponent.name.trim(),
    type: 'custom',
    icon: '🔧',
    description: this.customComponent.description.trim(),
    weight: 0.2,
    maxValue: this.customComponent.maxValue,
    mockValue: Math.random() * this.customComponent.maxValue
  };
  
  this.availableComponents.push(newComponent);
  this.closeCustomComponentModal();
  
  console.log('➕ Added custom component:', newComponent.name);
}

  // Modal methods
  closeConfigModal() {
    this.showConfigModal = false;
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
      case 'sample':
        this.applyToRandomSample();
        break;
    }
  }

  applyToSubnet(subnet: any) {
    this.closeSubnetModal();
    
    console.log(`🏠 Would apply configuration to subnet: ${subnet.subnet}`);
    console.log(`Current risk: ${subnet.riskScore}, Devices: ${subnet.deviceCount}`);
    
    const newRisk = this.calculatePreviewRisk();
    alert(`✅ Configuration prepared for ${subnet.subnet}!\n\nCurrent Risk: ${subnet.riskScore.toFixed(1)}\nPredicted New Risk: ${newRisk.toFixed(1)}\nDevices: ${subnet.deviceCount}\n\nNote: Implementation pending backend integration.`);
  }

  applyToRandomSample() {
    const sampleSize = Math.min(10, this.availableSubnets.length);
    const sample = this.availableSubnets.slice(0, sampleSize);
    
    console.log(`🎲 Would apply configuration to ${sampleSize} random subnets`);
    
    const changes = sample.map(subnet => {
      const newRisk = this.calculatePreviewRisk();
      return `${subnet.subnet}: ${subnet.riskScore.toFixed(1)} → ${newRisk.toFixed(1)}`;
    });
    
    alert(`✅ Configuration prepared for ${sampleSize} random subnets!\n\nPredicted changes:\n${changes.slice(0, 3).join('\n')}${changes.length > 3 ? '\n... and more' : ''}\n\nNote: Implementation pending backend integration.`);
  }
}