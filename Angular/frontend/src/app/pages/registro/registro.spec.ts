import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RegistroComponent } from './registro';

describe('RegistroComponent', () => {
  let component: RegistroComponent;
  let fixture: ComponentFixture<RegistroComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RegistroComponent] }).compileComponents();
    fixture = TestBed.createComponent(RegistroComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});