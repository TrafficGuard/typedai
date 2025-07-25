import {Component, Injectable} from '@angular/core';
import {SelectionModel} from '@angular/cdk/collections';
import {FlatTreeControl} from '@angular/cdk/tree';
import { MatTreeFlattener, MatTreeFlatDataSource, MatTree } from '@angular/material/tree';
import {of as ofObservable, Observable, BehaviorSubject} from 'rxjs';


/**
 * Node for filesystem item
 */
export class FileSystemNode {
  children: FileSystemNode[];
  item: string;
}

/** Flat to-do item node with expandable and level information */
export class FileSystemFlatNode {
  item: string;
  level: number;
  expandable: boolean;
}

/**
 * The Json object for filesystem tree data.
 */
const TREE_DATA = {
  // 'Folder': [
  //   'file1',
  //   'file2',
  //   'file3'
  // ],
  // 'Folder2': {
  //   'file4': null,
  //   'file5': null,
  //   'file6': null,
  //   'Folder3': {
  //     'file7': null,
  //     'file8': null,
  //     'Folder4': {
  //       'file9': null,
  //       'file10': null,
  //       'file11': null
  //     }
  //   }
  // }
};

/**
 * Checklist database, it can build a tree structured Json object.
 * Each node in Json object represents a to-do item or a category.
 * If a node is a category, it has children items and new items can be added under the category.
 */
@Injectable()
export class FileSystemDatabase {
  dataChange: BehaviorSubject<FileSystemNode[]> = new BehaviorSubject<FileSystemNode[]>([]);

  get data(): FileSystemNode[] { return this.dataChange.value; }

  constructor() {
    this.initialize();
  }

  initialize() {
    // Build the tree nodes from Json object. The result is a list of `TodoItemNode` with nested
    //     file node as children.
    const data = this.buildFileTree(TREE_DATA, 0);

    // Notify the change.
    this.dataChange.next(data);
  }

  /**
   * Build the file structure tree. The `value` is the Json object, or a sub-tree of a Json object.
   * The return value is the list of `TodoItemNode`.
   */
  buildFileTree(value: any, level: number) {
    let data: any[] = [];
    for (let k in value) {
      let v = value[k];
      let node = new FileSystemNode();
      node.item = `${k}`;
      if (v === null || v === undefined) {
        // no action
      } else if (typeof v === 'object') {
        node.children = this.buildFileTree(v, level + 1);
      } else {
        node.item = v;
      }
      data.push(node);
    }
    return data;
  }

  /** Add an item to to-do list */
  insertItem(parent: FileSystemNode, name: string) {
    const child = <FileSystemNode>{item: name};
    if (parent.children) {
      parent.children.push(child);
      this.dataChange.next(this.data);
    }
  }

  updateItem(node: FileSystemNode, name: string) {
    node.item = name;
    this.dataChange.next(this.data);
  }
}

/**
 * @title Tree with checkboxes
 */
@Component({
  selector: 'filesystem-tree',
  templateUrl: './filesystem-tree.component.html',
  styleUrls: ['./filesystem-tree.component.scss'],
  providers: [FileSystemDatabase],
  imports: [MatTree],
})
export class FilesystemTreeComponent {
  /** Map from flat node to nested node. This helps us finding the nested node to be modified */
  flatNodeMap: Map<FileSystemFlatNode, FileSystemNode> = new Map<FileSystemFlatNode, FileSystemNode>();

  /** Map from nested node to flattened node. This helps us to keep the same object for selection */
  nestedNodeMap: Map<FileSystemNode, FileSystemFlatNode> = new Map<FileSystemNode, FileSystemFlatNode>();

  /** A selected parent node to be inserted */
  selectedParent: FileSystemFlatNode | null = null;

  /** The new item's name */
  newItemName: string = '';

  treeControl: FlatTreeControl<FileSystemFlatNode>;

  treeFlattener: MatTreeFlattener<FileSystemNode, FileSystemFlatNode>;

  dataSource: MatTreeFlatDataSource<FileSystemNode, FileSystemFlatNode>;

  /** The selection for checklist */
  checklistSelection = new SelectionModel<FileSystemFlatNode>(true /* multiple */);

  constructor(private database: FileSystemDatabase) {
    this.treeFlattener = new MatTreeFlattener(this.transformer, this.getLevel,
      this.isExpandable, this.getChildren);
    this.treeControl = new FlatTreeControl<FileSystemFlatNode>(this.getLevel, this.isExpandable);
    this.dataSource = new MatTreeFlatDataSource(this.treeControl, this.treeFlattener);

    database.dataChange.subscribe(data => {
      this.dataSource.data = data;
    });
  }

  getLevel = (node: FileSystemFlatNode) => { return node.level; };

  isExpandable = (node: FileSystemFlatNode) => { return node.expandable; };

  getChildren = (node: FileSystemNode): Observable<FileSystemNode[]> => {
    return ofObservable(node.children);
  }

  hasChild = (_: number, _nodeData: FileSystemFlatNode) => { return _nodeData.expandable; };

  hasNoContent = (_: number, _nodeData: FileSystemFlatNode) => { return _nodeData.item === ''; };

  /**
   * Transformer to convert nested node to flat node. Record the nodes in maps for later use.
   */
  transformer = (node: FileSystemNode, level: number) => {
    let flatNode = this.nestedNodeMap.has(node) && this.nestedNodeMap.get(node)!.item === node.item
      ? this.nestedNodeMap.get(node)!
      : new FileSystemFlatNode();
    flatNode.item = node.item;
    flatNode.level = level;
    flatNode.expandable = !!node.children;
    this.flatNodeMap.set(flatNode, node);
    this.nestedNodeMap.set(node, flatNode);
    return flatNode;
  }

  /** Whether all the descendants of the node are selected */
  descendantsAllSelected(node: FileSystemFlatNode): boolean {
    const descendants = this.treeControl.getDescendants(node);
    return descendants.every(child => this.checklistSelection.isSelected(child));
  }

  /** Whether part of the descendants are selected */
  descendantsPartiallySelected(node: FileSystemFlatNode): boolean {
    const descendants = this.treeControl.getDescendants(node);
    const result = descendants.some(child => this.checklistSelection.isSelected(child));
    return result && !this.descendantsAllSelected(node);
  }

  /** Toggle the to-do item selection. Select/deselect all the descendants node */
  todoItemSelectionToggle(node: FileSystemFlatNode): void {
    this.checklistSelection.toggle(node);
    const descendants = this.treeControl.getDescendants(node);
    this.checklistSelection.isSelected(node)
      ? this.checklistSelection.select(...descendants)
      : this.checklistSelection.deselect(...descendants);
  }

  /** Select the category so we can insert the new item. */
  addNewItem(node: FileSystemFlatNode) {
    const parentNode = this.flatNodeMap.get(node);
    this.database.insertItem(parentNode!, '');
    this.treeControl.expand(node);
  }

  /** Save the node to database */
  saveNode(node: FileSystemFlatNode, itemValue: string) {
    const nestedNode = this.flatNodeMap.get(node);
    this.database.updateItem(nestedNode!, itemValue);
  }
}


/**  Copyright 2018 Google Inc. All Rights Reserved.
    Use of this source code is governed by an MIT-style license that
    can be found in the LICENSE file at http://angular.io/license */