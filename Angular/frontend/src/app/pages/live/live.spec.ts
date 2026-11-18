    
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LiveComponent } from './live';

describe('LiveComponent', () => {
  let component: LiveComponent;
  let fixture: ComponentFixture<LiveComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LiveComponent] }).compileComponents();
    fixture = TestBed.createComponent(LiveComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});