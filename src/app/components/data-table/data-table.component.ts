import { Component, Input, OnInit, OnChanges, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SubnetData } from '../../models/network-data';
import { TooltipService } from '../../services/tooltip.service';

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './data-table.component.html',
  styleUrls: ['./data-table.component.css']
})
export class DataTableComponent implements OnInit, OnChanges {
  @Input() networkData: SubnetData[] = [];
  @Output() subnetClick = new EventEmitter<SubnetData>();

  filteredData: SubnetData[] = [];
  currentPage = 1;
  pageSize = 10;
  totalPages = 1;
  searchTerm = '';
  filterType = 'all';
  sortField = 'riskScore';
  sortDirection: 'asc' | 'desc' = 'desc';
  private isHoveringTable = false;

constructor(private tooltipService: TooltipService) {}

  ngOnInit() {
    this.filterAndSort();
  }

  ngOnChanges() {
    this.filterAndSort();
  }

  showSubnetDetails(item: SubnetData) {
    console.log('Table row clicked:', item.subnet);
    this.subnetClick.emit(item);
  }

  filterAndSort() {
    let data = [...this.networkData];

    // Apply filter
    switch(this.filterType) {
      case 'high-risk':
        data = data.filter(item => item.riskLevel === 'high' || item.riskLevel === 'critical');
        break;
      case 'large':
        data = data.filter(item => item.deviceCount > 500);
        break;
    }

    // Apply search
    if (this.searchTerm) {
      data = data.filter(item => 
        item.subnet.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        item.riskLevel.toLowerCase().includes(this.searchTerm.toLowerCase())
      );
    }

    // Apply sorting
    data.sort((a, b) => {
      let valueA: any, valueB: any;

      switch(this.sortField) {
        case 'subnet':
          valueA = a.subnet.toLowerCase();
          valueB = b.subnet.toLowerCase();
          break;
        case 'deviceCount':
          valueA = a.deviceCount;
          valueB = b.deviceCount;
          break;
        case 'riskScore':
          valueA = a.riskScore;
          valueB = b.riskScore;
          break;
        case 'riskLevel':
          const riskOrder = { 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
          valueA = riskOrder[a.riskLevel as keyof typeof riskOrder];
          valueB = riskOrder[b.riskLevel as keyof typeof riskOrder];
          break;
        default:
          return 0;
      }

      if (this.sortDirection === 'asc') {
        return valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
      } else {
        return valueA > valueB ? -1 : valueA < valueB ? 1 : 0;
      }
    });

    this.filteredData = data;
    this.totalPages = Math.ceil(this.filteredData.length / this.pageSize);
    
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = this.totalPages;
    } else if (this.totalPages === 0) {
      this.currentPage = 1;
    }
  }

  get paginatedData(): SubnetData[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = Math.min(startIndex + this.pageSize, this.filteredData.length);
    return this.filteredData.slice(startIndex, endIndex);
  }

  get paginationInfo(): string {
    if (this.filteredData.length === 0) return 'No data available';
    const startIndex = (this.currentPage - 1) * this.pageSize + 1;
    const endIndex = Math.min(this.currentPage * this.pageSize, this.filteredData.length);
    return `Showing ${startIndex}-${endIndex} of ${this.filteredData.length} entries`;
  }

  onSearchChange() {
    this.currentPage = 1;
    this.filterAndSort();
  }

  onFilterChange() {
    this.currentPage = 1;
    this.filterAndSort();
  }

  onPageSizeChange() {
    this.currentPage = 1;
    this.filterAndSort();
  }

  sort(field: string) {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = ['subnet', 'riskLevel'].includes(field) ? 'asc' : 'desc';
    }
    this.currentPage = 1;
    this.filterAndSort();
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  getRiskClass(riskLevel: string): string {
    return `risk-${riskLevel}`;
  }

  getPageNumbers(): number[] {
    const maxVisible = 5;
    let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.totalPages, start + maxVisible - 1);
    
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

showTooltip(event: MouseEvent, item: SubnetData): void {
    this.tooltipService.showSubnetTooltip(event, item);
  }

  hideTooltip(): void {
    this.tooltipService.hide();
  }

  onRowClick(item: SubnetData): void {
    this.tooltipService.hide();
    this.showSubnetDetails(item);
  }

}